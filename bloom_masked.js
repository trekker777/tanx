//--------------- POST EFFECT DEFINITION------------------------//
pc.extend(pc.posteffect, function () {
    var SAMPLE_COUNT = 15;
    // var flip = 'vec2(1.0,1.0)-';
    var flip = '';

    function computeGaussian(n, theta) {
        return ((1.0 / Math.sqrt(2 * Math.PI * theta)) * Math.exp(-(n * n) / (2 * theta * theta)));
    }

    function calculateBlurValues(sampleWeights, sampleOffsets, dx, dy, blurAmount) {
        // Look up how many samples our gaussian blur effect supports.

        // Create temporary arrays for computing our filter settings.
        // The first sample always has a zero offset.
        sampleWeights[0] = computeGaussian(0, blurAmount);
        sampleOffsets[0] = 0;
        sampleOffsets[1] = 0;

        // Maintain a sum of all the weighting values.
        var totalWeights = sampleWeights[0];

        // Add pairs of additional sample taps, positioned
        // along a line in both directions from the center.
        var i, len;
        for (i = 0, len = Math.floor(SAMPLE_COUNT / 2); i < len; i++) {
            // Store weights for the positive and negative taps.
            var weight = computeGaussian(i + 1, blurAmount);
            sampleWeights[i*2] = weight;
            sampleWeights[i*2+1] = weight;
            totalWeights += weight * 2;

            // To get the maximum amount of blurring from a limited number of
            // pixel shader samples, we take advantage of the bilinear filtering
            // hardware inside the texture fetch unit. If we position our texture
            // coordinates exactly halfway between two texels, the filtering unit
            // will average them for us, giving two samples for the price of one.
            // This allows us to step in units of two texels per sample, rather
            // than just one at a time. The 1.5 offset kicks things off by
            // positioning us nicely in between two texels.
            var sampleOffset = i * 2 + 1.5;

            // Store texture coordinate offsets for the positive and negative taps.
            sampleOffsets[i*4] = dx * sampleOffset;
            sampleOffsets[i*4+1] = dy * sampleOffset;
            sampleOffsets[i*4+2] = -dx * sampleOffset;
            sampleOffsets[i*4+3] = -dy * sampleOffset;
        }

        // Normalize the list of sample weightings, so they will always sum to one.
        for (i = 0, len = sampleWeights.length; i < len; i++) {
            sampleWeights[i] /= totalWeights;
        }
    }

    var BloomMasked = function (graphicsDevice) {
        // Shaders
        var attributes = {
            aPosition: pc.gfx.SEMANTIC_POSITION
        };

        var passThroughVert = [
            "attribute vec2 aPosition;",
            "",
            "varying vec2 vUv0;",
            "",
            "void main(void)",
            "{",
            "    gl_Position = vec4(aPosition, 0.0, 1.0);",
            "    vUv0 = (aPosition + 1.0) * 0.5;",
            "}"
        ].join("\n");

        // Pixel shader extracts the brighter areas of an image.
        // This is the first step in applying a bloom postprocess.
        var bloomExtractFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "",
            "varying vec2 vUv0;",
            "",
            "uniform sampler2D uBaseTexture;",
            "uniform float uBloomThreshold;",
            "",
            "void main(void)",
            "{",
                 // Look up the original image color.
            "    vec4 color = texture2D(uBaseTexture, vUv0);",
            "",
                 // Adjust it to keep only values brighter than the specified threshold.
            "    gl_FragColor = clamp((color - uBloomThreshold) / (1.0 - uBloomThreshold), 0.0, 1.0);",
            "}"
        ].join("\n");

        // Pixel shader applies a one dimensional gaussian blur filter.
        // This is used twice by the bloom postprocess, first to
        // blur horizontally, and then again to blur vertically.
        var gaussianBlurFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "",
            "#define SAMPLE_COUNT " + SAMPLE_COUNT,
            "",
            "varying vec2 vUv0;",
            "",
            "uniform float uMaskMix;",
            "uniform sampler2D uBloomTexture;",
            "uniform vec2 uBlurOffsets[SAMPLE_COUNT];",
            "uniform float uBlurWeights[SAMPLE_COUNT];",
            "uniform sampler2D uMaskTexture;",
            "",
            "void main(void)",
            "{",
            "    vec4 color = vec4(0.0);",
            "    float maskFactor = texture2D(uMaskTexture, " + flip + "vUv0).r;",
            "    maskFactor = mix(1.0, maskFactor, uMaskMix);",
                 // Combine a number of weighted image filter taps.
            "    for (int i = 0; i < SAMPLE_COUNT; i++)",
            "    {",
            "        color += texture2D(uBloomTexture, vUv0 + uBlurOffsets[i] * maskFactor) * uBlurWeights[i];",
            // "        color += texture2D(uBloomTexture, vUv0 + uBlurOffsets[i]) * uBlurWeights[i];",
            "    }",
            "",
            "    gl_FragColor = color;",
            "}"
        ].join("\n");

        // Pixel shader combines the bloom image with the original
        // scene, using tweakable intensity levels.
        // This is the final step in applying a bloom postprocess.
        var bloomCombineFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "",
            "varying vec2 vUv0;",
            "",
            "uniform float uBloomIntensity;",
            "uniform sampler2D uBaseTexture;",
            "uniform sampler2D uBloomTexture;",
            "uniform sampler2D uMaskTexture;",
            "",
            "void main(void)",
            "{",
                 // Look up the bloom and original base image colors.
            "    vec4 bloom = texture2D(uBloomTexture, " + flip + "vUv0) * uBloomIntensity;",
            "    vec4 base = texture2D(uBaseTexture, vUv0);",
            "    vec4 mask = texture2D(uMaskTexture, vUv0);",
            "    bloom *= mask;",
            "",
                 // Darken down the base image in areas where there is a lot of bloom,
                 // to prevent things looking excessively burned-out.
            "    base *= (1.0 - clamp(bloom, 0.0, 1.0));",
            "",
                 // Combine the two images.
            "    gl_FragColor = base + bloom;",
            "}"
        ].join("\n");

        this.extractShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: bloomExtractFrag
        });
        this.blurShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: gaussianBlurFrag
        });
        this.combineShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: bloomCombineFrag
        });

        // Render targets
        var width = graphicsDevice.width;
        var height = graphicsDevice.height;
        this.targets = [];
        for (var i = 0; i < 2; i++) {
            var colorBuffer = new pc.gfx.Texture(graphicsDevice, {
                format: pc.gfx.PIXELFORMAT_R8_G8_B8,
                width: (width >> 1) / 2,
                height: (height >> 1) / 2
            });
            colorBuffer.minFilter = pc.gfx.FILTER_LINEAR;
            colorBuffer.magFilter = pc.gfx.FILTER_LINEAR;
            colorBuffer.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            colorBuffer.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            var target = new pc.gfx.RenderTarget(graphicsDevice, colorBuffer, { depth: false });

            this.targets.push(target);
        }

        // Effect defaults
        this.bloomThreshold = 0.25;
        this.blurAmount = 4;
        this.bloomIntensity = 1.25;
        this.maskTexture = null;
        this.maskMix = 0.5;

        // Uniforms
        this.sampleWeights = new Float32Array(SAMPLE_COUNT);
        this.sampleOffsets = new Float32Array(SAMPLE_COUNT * 2);
    }

    BloomMasked = pc.inherits(BloomMasked, pc.posteffect.PostEffect);

    BloomMasked.prototype = pc.extend(BloomMasked.prototype, {
        render: function (inputTarget, outputTarget, rect) {
            var device = this.device;
            var scope = device.scope;

            // Pass 1: draw the scene into rendertarget 1, using a
            // shader that extracts only the brightest parts of the image.
            scope.resolve("uBloomThreshold").setValue(this.bloomThreshold);
            scope.resolve("uBaseTexture").setValue(inputTarget.colorBuffer);
            pc.posteffect.drawFullscreenQuad(device, this.targets[0], this.vertexBuffer, this.extractShader);

            // Pass 2: draw from rendertarget 1 into rendertarget 2,
            // using a shader to apply a horizontal gaussian blur filter.
            calculateBlurValues(this.sampleWeights, this.sampleOffsets, 1.0 / this.targets[1].width, 0, this.blurAmount);
            scope.resolve("uBlurWeights[0]").setValue(this.sampleWeights);
            scope.resolve("uBlurOffsets[0]").setValue(this.sampleOffsets);
            scope.resolve("uBloomTexture").setValue(this.targets[0].colorBuffer);
            scope.resolve("uMaskMix").setValue(this.maskMix);
            scope.resolve("uMaskTexture").setValue(this.maskTexture);
            pc.posteffect.drawFullscreenQuad(device, this.targets[1], this.vertexBuffer, this.blurShader);

            // Pass 3: draw from rendertarget 2 back into rendertarget 1,
            // using a shader to apply a vertical gaussian blur filter.
            calculateBlurValues(this.sampleWeights, this.sampleOffsets, 0, 1.0 / this.targets[0].height, this.blurAmount);
            scope.resolve("uBlurWeights[0]").setValue(this.sampleWeights);
            scope.resolve("uBlurOffsets[0]").setValue(this.sampleOffsets);
            scope.resolve("uMaskMix").setValue(this.maskMix);
            scope.resolve("uMaskTexture").setValue(this.maskTexture);
            scope.resolve("uBloomTexture").setValue(this.targets[1].colorBuffer);
            pc.posteffect.drawFullscreenQuad(device, this.targets[0], this.vertexBuffer, this.blurShader);

            // Pass 4: draw both rendertarget 1 and the original scene
            // image back into the main backbuffer, using a shader that
            // combines them to produce the final bloomed result.
            scope.resolve("uBloomIntensity").setValue(this.bloomIntensity);
            scope.resolve("uMaskMix").setValue(this.maskMix);
            scope.resolve("uMaskTexture").setValue(this.maskTexture);
            scope.resolve("uBloomTexture").setValue(this.targets[0].colorBuffer);
            pc.posteffect.drawFullscreenQuad(device, outputTarget, this.vertexBuffer, this.combineShader, rect);
        }
    });

    return {
        BloomMasked: BloomMasked
    };
}());

//--------------- SCRIPT ATTRIBUTES------------------------//

pc.script.attribute('bloomIntensity', 'number', 1, {
    min: 0,
    step: 0.5,
    displayName: 'Bloom Intensity'
});

pc.script.attribute('bloomThreshold', 'number', 0.25, {
    min: 0,
    step: 0.01,
    max: 1,
    displayName: 'Bloom Threshold'
});

pc.script.attribute('blurAmount', 'number', 4, {
    min: 1,
    displayName: 'Blur Amount'
});

pc.script.attribute('maskTexture', 'asset');

pc.script.attribute('maskMix', 'number', 0.5, {
    min: 0,
    step: 0.01,
    max: 1,
    displayName: 'Mask Mix'
});

//--------------- SCRIPT DEFINITION------------------------//

pc.script.create('bloom_mask', function (context) {
    var BloomMasked = function (entity) {
        this.entity = entity;
        this.effect = new pc.posteffect.BloomMasked(context.graphicsDevice);
    };

    BloomMasked.prototype = {
        initialize:  function () {
            this.on('set', this.onAttributeChanged, this);

            this.effect.bloomThreshold = this.bloomThreshold;
            this.effect.blurAmount = this.blurAmount;
            this.effect.bloomIntensity = this.bloomIntensity;
            this.effect.maskTexture = context.assets.getAssetById(this.maskTexture[0]).resource;
            this.effect.maskMix = this.maskMix;
        },

        onAttributeChanged: function (name, oldValue, newValue) {
            if (name === 'maskTexture') {
                this.effect[name] = context.assets.getAssetById(newValue[0]).resource;
            } else {
                this.effect[name] = newValue;
            }
        },

        onEnable: function () {
            this.entity.camera.postEffects.addEffect(this.effect);
        },

        onDisable: function () {
            this.entity.camera.postEffects.removeEffect(this.effect);
        }
    };

    return BloomMasked;
});