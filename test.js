/**
 * Module dependencies.
 */

var express = require('express')
var form    = require('connect-form');
var logger  = require('./logger.js');

var app     = express.createServer(
    // connect-form (http://github.com/visionmedia/connect-form)
    // middleware uses the formidable middleware to parse urlencoded
    // and multipart form data
    form({keepExtensions: true})
);

app.get('/', function(req, res) {
    res.send('<form method="post" enctype="multipart/form-data">'
        + '<p>Picture: <input type="file" name="picture" /></p>'
        + '<p><input type="submit" value="Upload" /></p>'
        + '</form>');
});

app.post('/', function(req, res, next) {
    // connect-form adds the req.form object
    // we can (optionally) define onComplete, passing
    // the exception (if any) fields parsed, and files parsed
    req.form.complete(function(err, fields, files) {
        if (err) {
            next(err);
        } else {
            logger.info('\nuploaded %s to %s', files.picture.filename, files.picture.path);
            res.redirect('back');
        }
    });

    // We can add listeners for several form
    // events such as "progress"
    req.form.on('progress', function(bytesReceived, bytesExpected) {
        var percent = (bytesReceived / bytesExpected * 100) | 0;
        process.stdout.write('Uploading: %' + percent + '\r');
    });
});

app.listen(3000);
logger.info('Express app started on port 3000');
