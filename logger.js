var fs      = require('fs');
var logger  = require('tracer').colorConsole({level:'debug'});
var logger1 = require('tracer').console({
    level : 'info',
    format : [
        "{{timestamp}} [{{title}}] [{{file}}:{{line}}:{{method}}] {{message}}",
        {
            error : "{{timestamp}} [{{title}}] [{{file}}:{{line}}:{{method}}] {{message}} \nCall Stack:{{stacklist}}"
        }
    ],
    dateformat : "yyyy-mm-dd HH:MM:ss,L",
    transport : function(data){
        fs.open('./file.log', 'a', 0644, function(e, id) {
            fs.write(id, data.output+"\n", null, 'utf8', function() {
                fs.close(id, function() {
                });
            });
        });
    }
});

module.exports = logger
