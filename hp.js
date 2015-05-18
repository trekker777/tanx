pc.script.create('hp', function (context) {
    var Hp = function (entity) {
        var css = [
            "#score {",
            "   position: absolute;",
            "   top: 16px;",
            "   left: calc(50% - 16px);",
            "   width: 32px;",
            "   height: 32px;",
            "   line-height: 32px;",
            "   background-color: rgb(33, 34, 36);",
            "   text-align: center;",
            "   font-size: 24px;",
            "   color: #fff;",
            "}",
        ].join('\n');
        
        var style = document.createElement('style');
        style.innerHTML = css;
        document.querySelector('head').appendChild(style);
        
        var score = this.score = document.createElement('div');
        score.id = 'score';
        score.textContent = '0';
        document.body.appendChild(score);
        
        this.points = 0;
    };

    Hp.prototype = {
        set: function(hp) { },
        
        setScore: function(score) {
            this.score.textContent = score;
        }
    };

    return Hp;
});