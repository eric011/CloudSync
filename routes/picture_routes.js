var fs        = require('fs');
var gm        = require('gm');
var https     = require('https');
var oauth     = require('oauth');
var path      = require('path');
var zipstream = require('zipstream');

var logger    = require('../logger.js');

var Picture;

var HTTP_RESPONSE_SUCCESS_OK               = 200;
var HTTP_RESPONSE_SUCCESS_NO_CONTENT       = 204;
var HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST = 400;
var HTTP_REQUEST_ENTITY_TOO_LARGE          = 413;
var HTTP_RESPONSE_SERVER_ERROR             = 500;
var HTTP_RESPONSE_NOT_IMPLEMENTED          = 501;

var outputdir  = __dirname + '/../../tempdir/';
var appaddress = 'http://cloudsync.peeknet.net';
var chunkSize  = 2 * 1024;



exports.setPictureModel = function(db) {
    Picture = require('../models.js').Picture(db);
    return Picture;
};


// Send a JSON object with all information for pictures belonging to the current user
exports.picturesGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures");
    logger.debug("[picturesGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        Picture.find({share_key: req.currentUser.share_key}, ['original_file_name', 'file_size'], {sort: [['original_file_name', 'ascending']]}, function(err, results) {
            if(err) {
                logger.error("[picturesGET] 500 Database search error (syncService): " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[picturesGET] Successfully sending JSON in response (syncService): " + results);
                if(results.length != 0) {
                    res.json(results, HTTP_RESPONSE_SUCCESS_OK);
                } else {
                    res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                }
            }
        });
    } else {
        Picture.find({share_key: req.currentUser.share_key}, ['original_file_name', 'file_size', 'file_path'], {sort: [['original_file_name', 'ascending']]}, function(err, results) {
            if(err) {
                logger.error("[picturesGET] 500 Database search error (syncweb): " + err);
                res.redirect('/500');
            } else {
                logger.debug("[picturesGET] Successfully sending JSON in response (syncweb): " + results);
                res.render('pictures/index.jade', {
                    locals : {
                        pictures : results,
                        number   : req.currentUser.number,
                        isAdmin  : req.currentUser.isAdmin
                    },
                    layout : 'with_user_info_layout'
                });
            }
        });
    }
};

// Receive a single picture as a POST and save it to the file system
exports.picturesPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/pictures");
    logger.debug("[picturesPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        var picture         = new Picture();

        var origFileName    = req.header("Content-disposition");
        var filePath        = picture.id + origFileName;
        var path            = outputdir + filePath;
        var fileWriteStream = fs.createWriteStream(path, {flags:'w+', encoding:null, mode:0666});

        req.streambuffer.ondata(function(chunk) {
            fileWriteStream.write(chunk);
            if(fileWriteStream.bytesWritten > 1e6) {
                fileWriteStream.destroy();
                logger.error("[picturesPOST] 413 ERROR: flood attack");
                res.send(HTTP_REQUEST_ENTITY_TOO_LARGE);
            }
        });

        req.streambuffer.onend(function() {
            if(fileWriteStream.writable) {
                fileWriteStream.end();
            }

            logger.debug("[picturesPOST] Make sure the required directories exist with the correct permissions.");
            fs.stat(outputdir + ".thumbs/", function(err, stats) {
                if(err && err.errno == 34) {
                    logger.debug("[picturesPOST] Create the .thumbs directory.");
                    fs.mkdir(outputdir + ".thumbs/", function(err) {
                        if(err) {
                            logger.error("[picturesPOST] 500 Creation of the /.thumbs directory failed: " + err);
                            removeFromFS();
                        } else {
                            getFileSize();
                        }
                    });
                } else if(!err) {
                    getFileSize();
                } else {
                    logger.error("[picturesPOST] 500 fs.stat on the /.thumbs directory failed: " + err);
                    removeFromFS();
                }
            });

            function getFileSize() {
                logger.debug("[picturesPOST] Get the created image fileSize.");
                fs.stat(path, function (err, stat) {
                    if(err) {
                        logger.error("[picturesPOST] 500 Failed to get the filesize of the image: " + err);
                        removeFromFS();
                    } else {
                        logger.debug("[picturesPOST] Save the required information for the saved picture: " + origFileName);
                        picture.original_file_name = origFileName;
                        picture.file_path          = filePath;
                        picture.share_key          = req.currentUser.share_key;
                        picture.file_size          = stat.size;
                        picture.save(function(err) {
                            if(err) {
                                logger.error("[picturesPOST] 400 Problem saving the new picture to db: " + err);
                                removeFromFS();
                            } else {
                                mkThumb();
                            }
                        });
                    }
                });
            }

            function mkThumb() {
                logger.debug("[picturesPOST] Create a thumbnail and save it to disk.");
                gm(path).thumb(100, 100, outputdir + ".thumbs/" + filePath, 100, function(err) {
                    if(err) {
                        logger.error("[picturesPOST] 400 Thumbnail creation failed: " + err);
                        removeFromFS();
                    } else {
                        logger.debug("[picturesPOST] The image POST was successful: " + picture.id);
                        var jsonResponse = new Array();
                        jsonResponse.push({pictureID:picture.id});
                        res.json(jsonResponse, HTTP_RESPONSE_SUCCESS_OK);
                        require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                    }
                });
            }


            function removeFromFS() {
                logger.debug("[picturesPOST] Removing the picture from the FS.");
                fs.unlink(path, function(err) {
                    if(err) {
                        logger.error("[picturesPOST] 400 Error with deleting picture from FS: " + err);
                        removeFromDB();
                    } else {
                        removeFromDB();
                    }
                });
            }

            function removeFromDB() {
                logger.debug("[picturesPOST] Removing the picture from the DB.");
                picture.remove(function(err) {
                    if(err) {
                        logger.error("[picturesPOST] 400 Error with deleting picture from DB: " + err);
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                    } else {
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                    }
                });
            }
        });

        req.on('close', function() {
            logger.debug("[picturesPOST] Request received a close.");
            if(fileWriteStream.writable) {
                fileWriteStream.end();
            }
        });

        fileWriteStream.on('error', function(err) {
            logger.error("[picturesPOST] 500 ERROR fileWriteStream.destroy(): " + err);
            fileWriteStream.destroy();
            res.send(HTTP_RESPONSE_SERVER_ERROR);
        });

        fileWriteStream.on('close', function() {
            logger.error("[picturesPOST] fileWriteStream received a close.");
        });
    } else {
        logger.error("[picturesPOST]501 Trying to hit route from syncweb");
        res.redirect('/501');
    }
};


// GET method for an individual picture
exports.picturesIdGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/" + req.params.pictureId);
    logger.debug("[picturesIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    Picture.findOne({_id: req.params.pictureId, share_key: req.currentUser.share_key}, function(err, result) {
        if(err) {
            logger.error("[picturesIdGET] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            if(req.params.service == 'syncService') {
                logger.debug("[picturesIdGET] Going to send the image " + result.id + " to syncService.");

                var re   = /(?:\.([^.]+))?$/;
                var ext  = re.exec(result.original_file_name)[1];
                var head = {'Content-Type': 'image/' + ext};
                head['Transfer-Encoding']   = 'chunked';
                head['Content-disposition'] = result.original_file_name;
                res.writeHead(200, head)

                fs.createReadStream(outputdir + result.file_path, {'bufferSize': 64 * 1024}).pipe(res);

                // Used for testing, to allow for handling of individual chunks
                /*
                fs.createReadStream(outputdir + result.file_path, {'bufferSize': chunkSize})
                    .addListener("data", function(chunk) {
                        logger.debug("[picturesIdGET] [Sent chunk for image]");
                        setTimeout(function() {
                            res.write(chunk, 'binary');
                        }, 75);
                        //res.write(chunk, 'binary');
                    })
                    .addListener("close", function() {
                        logger.debug("[picturesIdGET] [Sent close for image]");
                        res.end();
                    });
                */

            } else {
                logger.debug("[picturesIdGET] Going to send the image " + result.id + " to be rendered on syncweb.");
                res.render('pictures/show.jade', {
                    locals : {
                        picture : result,
                        number  : req.currentUser.number,
                        isAdmin : req.currentUser.isAdmin
                    },
                    layout : 'with_user_info_layout'
                });
            }
        }
    });
};

// Paginated GET method for an individual picture
exports.picturesIdOpLengthOffsetGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/" + req.params.pictureId + "/op/" + req.params.length + "/" + req.params.offset);
    logger.debug("[picturesIdOpLengthOffsetGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        Picture.findOne({_id: req.params.pictureId, share_key: req.currentUser.share_key}, function(err, result) {
            if(err) {
                logger.error("[picturesIdOpLengthOffsetGET] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                var re   = /(?:\.([^.]+))?$/;
                var ext  = re.exec(result.original_file_name)[1];
                var head = {'Content-Type': 'image/' + ext};
                head['Transfer-Encoding']   = 'chunked';
                head['Content-disposition'] = result.original_file_name;
                res.writeHead(200, head)

                var startPos = parseInt(req.params.offset, "10");
                var endPos   = startPos + parseInt(req.params.length, "10") - 1;

                if(startPos < 0 || endPos > (parseInt(req.params.file_size, "10") + 1)) {
                    logger.error("[picturesIdOpLengthOffsetGET] 400 BAD REQUEST: Paginated pictures get passed a bad offset/length.");
                    res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                } else {
                    logger.debug("[picturesIdOpLengthOffsetGET] Going to send the image " + result.id + " paginated to syncService from " + startPos + " to " + endPos + ".");
                    fs.createReadStream(outputdir + result.file_path, {'bufferSize': chunkSize, 'start': startPos, 'end': endPos}).pipe(res);

                    // Used for testing, to allow for handling of individual chunks
                    /*
                    fs.createReadStream(outputdir + result.file_path, {'bufferSize': chunkSize, 'start': startPos, 'end': endPos})
                        .addListener("data", function(chunk) {
                            logger.debug("[Sent chunk for image]");
                            setTimeout(function() {
                                res.write(chunk, 'binary');
                            }, 75);
                            //res.write(chunk, 'binary');
                        })
                        .addListener("close", function() {
                            logger.debug("[Sent close for image]");
                            res.end();
                        });
                    */
                }
            }
        });
    } else {
        logger.error("[picturesIdOpLengthOffsetGET] Route is only for syncService clients.");
        res.redirect('/500');
    }
};

// DEL method for an individual picture
exports.picturesIdDEL = function(req, res) {
    logger.info("DEL /" + req.params.service + "/pictures/" + req.params.pictureId);
    logger.debug("[picturesIdDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    Picture.findOne({_id: req.params.pictureId, share_key: req.currentUser.share_key}, function(err, result) {
        if(err) {
            logger.error("[picturesIdDEL] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            removeFromFS();

            function removeFromFS() {
                logger.debug("[picturesIdDEL] Attempt to remove the image from the FS.");
                fs.unlink(outputdir + result.file_path, function(err) {
                    if(err) {
                        logger.error("[picturesIdDEL] 500 Error with deleting picture: " + err);
                        removeThumbFromFS();
                    } else {
                        removeThumbFromFS();
                    }
                });
            }

            function removeThumbFromFS() {
                logger.debug("[picturesIdDEL] Attempt to remove the thumbnail from the FS.");
                fs.unlink(outputdir + '.thumbs/' + result.file_path, function(err) {
                    if (err) {
                        logger.error("[picturesIdDEL] 500 Error with deleting thumbnail: " + err);
                        removeFromDB();
                    } else {
                        removeFromDB();
                    }
                });
            }

            function removeFromDB() {
                logger.debug("[picturesIdDEL] Attempt to remove the image from the DB.");
                result.remove(function(err) {
                    if(err) {
                        logger.error("[picturesIdDEL] 500 Error with removing image from database: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            res.redirect('/500');
                        }
                    } else {
                        logger.debug("[picturesIdDEL] Image removed successfully.");
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                        } else {
                            res.redirect('/syncweb/pictures');
                        }
                    }
                });
            }
        }
    });
};


// Download all images
exports.picturesOpDlGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/op/dl");
    logger.debug("[picturesOpDlGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[picturesOpDlGET] 501 Trying to hit picturesDlGET route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        Picture.find({share_key: req.currentUser.share_key}, ['original_file_name', 'file_path'], {sort: [['original_file_name', 'ascending']]}, function(err, pictureMetaData) {
            if(err) {
                logger.error("[picturesOpDlGET] 500 Database search error: " + err);
                res.redirect('/500');
            } else if (pictureMetaData.length == 0) {
                logger.warn("[picturesOpDlGET] No images.");
                res.redirect("/syncweb/pictures");
            } else {
                // This check may be redundant, if the directory is created on deployment
                logger.debug("[picturesOpDlGET] Make sure the directory exists with the correct permissions.");
                fs.stat(outputdir, function(err, stats) {
                    if(err && err.errno == 34) {
                        fs.mkdir(outputdir, function(err) {
                            if(err) {
                                logger.error("[picturesOpDlGET] 500 Creating the outputdir failed: " + err);
                                res.redirect('/500');
                            } else {
                                mkOutput();
                            }
                        });
                    } else if(!err) {
                        mkOutput();
                    } else {
                        logger.error("[picturesOpDlGET] 500 There was an issue with the outputdir: " + err);
                        res.redirect('/500');
                    }
                });

                function mkOutput() {
                    logger.debug("[picturesOpDlGET] Start the creation of the zipfile.");

                    var now     = Date.now();
                    var outPath = outputdir + req.currentUser.id + now + 'pictures.zip';
                    var out     = fs.createWriteStream(outPath);
                    var zip     = zipstream.createZip({level: 1});
                    zip.pipe(out);

                    recurseZip(pictureMetaData.pop());

                    // Recursively and asynchronously adds pictures to the pictures zip archive
                    function recurseZip(picture) {
                        if(picture) {
                            fs.stat(outputdir + picture.file_path, function(err, stats) {
                                if(!err && stats.isFile()) {
                                    logger.debug("[picturesOpDlGET] Add " + picture_original_file_name + " to the zip.");
                                    zip.addFile(fs.createReadStream(outputdir + picture.file_path), {name: picture.original_file_name}, function(err) {
                                        if(err) {
                                            logger.error("[picturesOpDlGET] 500 Error with adding file to zip: " + err);
                                            recurseZip(pictureMetaData.pop());
                                        } else {
                                            recurseZip(pictureMetaData.pop());
                                        }
                                    });
                                } else if(err) {
                                    logger.error("[picturesOpDlGET] 500 Error with picture validation: " + err);
                                    recurseZip(pictureMetaData.pop());
                                } else {
                                    logger.error("[picturesOpDlGET] 500 Not a valid file: " + err);
                                    recurseZip(pictureMetaData.pop());
                                }
                            });
                        } else {
                            logger.debug("[picturesOpDlGET] Finalize the zip file.");
                            zip.finalize(function(written) {
                                logger.debug("[picturesOpDlGET] Send the zip file to the user for download.");

                                var filepath = path.normalize(outPath);
                                res.download(filepath, 'pictures.zip', function(err) {
                                    if(err) {
                                        logger.error("[picturesOpDlGET] 500 Downloading the zip failed: " + err);
                                        res.redirect('/500');
                                    } else {
                                        fs.unlink(filepath, function(err) {
                                            if(err) {
                                                logger.error("[picturesOpDlGET] 500 Deleting the zip failed: " + err);
                                                res.redirect('/500');
                                            } else {
                                                logger.debug("[picturesOpDlGET] The zip creation was successful.");
                                            }
                                        });
                                    }
                                });
                            });
                        }
                    }
                }
            }
        });
    }
};

// Download a single image on syncweb
exports.picturesOpDlIdGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/op/dl/" + req.params.pictureId);
    logger.debug("[picturesOpDlIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[picturesOpDlIdGET] 501 Trying to hit picturesDlIdGET route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        Picture.findOne({_id: req.params.pictureId, share_key: req.currentUser.share_key}, function(err, result) {
            if(err) {
                logger.error("[picturesOpDlIdGET] 500 Database search error: " + err);
                res.redirect('/500');
            } else {
                logger.debug("[picturesOpDlIdGET] Make sure the directory exists with the correct permissions.");
                fs.stat(outputdir + result.file_path, function(err, stats) {
                    if(!err && stats.isFile()) {
                        logger.debug("[picturesOpDlGET] Start the image download: " + result.original_file_name);
                        var filepath = path.normalize(outputdir + result.file_path);
                        res.download(filepath, result.original_file_name, function(err){
                            if(err) {
                                logger.error("[picturesOpDlIdGET] 500 Downloading the image failed: " + err);
                                res.redirect('/500');
                            }
                        });
                    } else if(err) {
                        logger.error("[picturesOpDlIdGET] 500 Error with picture validation: " + err);
                        res.redirect('/500');
                    } else {
                        logger.error("[picturesOpDlIdGET] 500 Not a valid file: " + err);
                        res.redirect('/500');
                    }
                });
            }
        });
    }
};

// Allow the user to authenticate their Facebook account
exports.picturesOpFacebookOAuthIdGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/op/facebookOAuth/" + req.params.pictureId);
    logger.debug("[picturesOpFacebookOAuthIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        logger.error("[picturesOpFacebookOAuthIdGET] 501 Trying to hit the route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        logger.debug("[picturesOpFacebookOAuthIdGET] Start the oauth process.");

        var client_id     = "329688480441015";
        var client_secret = "7cb5d54d25a6797bb36e11049756ba91";
        var address       = appaddress + "/" + req.params.service + "/pictures/op/facebookUpload/" + req.params.pictureId;

        oa = new oauth.OAuth2(client_id, client_secret, "https://graph.facebook.com");
        res.redirect(oa.getAuthorizeUrl(
            {
                scope         : "publish_stream",
                response_type : "code",
                redirect_uri  : address
            }
        ));
    }
};

// Allow the user to publish a photo to their authenticated Facebook account
exports.picturesOpFacebookUploadIdGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/pictures/op/facebookUpload/" + req.params.pictureId);
    logger.debug("[picturesOpFacebookUploadIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        logger.error("[picturesOpFacebookUploadIdGET] 501 Trying to hit the route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        var address = appaddress + '/' + req.params.service + '/pictures/op/facebookUpload/' + req.params.pictureId;

        oa.getOAuthAccessToken(req.query.code, {grant_type:'authorization_code', redirect_uri:address}, function(err, access_token, refresh_token) {
            if(err) {
                logger.error("[picturesOpFacebookUploadIdGET] 500 Error getting the OAuth Access token for Facebook sharing: " + err);
                res.redirect('/500');
            } else {
                Picture.findOne({_id: req.params.pictureId, share_key: req.currentUser.share_key}, function(err, result) {
                    if(err) {
                        logger.error("[picturesOpFacebookUploadIdGET] 500 Database search error: " + err);
                        res.redirect('/500');
                    } else {
                        logger.debug("[picturesOpFacebookUploadIdGET] Set up the header for uploading the image: " + result.original_file_name);

                        var enc      = 'binary';
                        var filepath = outputdir + result.file_path;
                        var filename = result.original_file_name;
                        var re       = /(?:\.([^.]+))?$/;
                        var ext      = re.exec(filename)[1];
                        var authKey  = access_token;

                        var outputBits = [];
                        outputBits.push('------------0xKhTmLbOuNdArY\r\n');
                        outputBits.push('Content-Disposition: form-data; name="access_token"\r\n\r\n');
                        outputBits.push(authKey + '\r\n');
                        outputBits.push('------------0xKhTmLbOuNdArY\r\n');
                        outputBits.push('Content-Disposition: form-data; name="message"\r\n\r\n');
                        outputBits.push(filename + '\r\n');
                        outputBits.push('------------0xKhTmLbOuNdArY\r\n');
                        outputBits.push('Content-Disposition: form-data; name="source"; filename="' + filepath + '"\r\n');
                        outputBits.push('Content-Type: image/' + ext + '\r\n');
                        outputBits.push('Content-Transfer-Encoding: ' + enc + '\r\n\r\n');
                        var output0    = outputBits.join("");

                        var outputBits2 = [];
                        outputBits2.push('\r\n------------0xKhTmLbOuNdArY--\r\n');
                        var output2     = outputBits2.join("");

                        fs.readFile(filepath, function(err, imageData) {
                            if(err) {
                                logger.error("[picturesOpFacebookUploadIdGET] 500 Error reading the image for Facebook sharing: " + err);
                                res.redirect('/500');
                            } else {
                                logger.debug("[picturesOpFacebookUploadIdGET] Set up the request for uploading the image: " + result.original_file_name);

                                var options = {
                                    host    : 'graph.facebook.com',
                                    port    : 443,
                                    path    : '/me/photos',
                                    method  : 'POST',
                                    headers :
                                        {
                                            'Content-Type'   : 'multipart/form-data; boundary=----------0xKhTmLbOuNdArY',
                                            'Content-Length' : output0.length + imageData.length + output2.length
                                        }
                                };

                                var request = https.request(options, function(response) {
                                    logger.debug('[picturesOpFacebookUploadIdGET] STATUS: ' + response.statusCode);
                                    logger.debug('[picturesOpFacebookUploadIdGET] HEADERS: ' + JSON.stringify(response.headers));
                                    response.setEncoding('utf8');

                                    response.on('data', function(chunk) {
                                        logger.debug('[picturesOpFacebookUploadIdGET] BODY: ' + chunk);
                                    });

                                    response.on('end', function() {
                                        logger.debug("[picturesOpFacebookUploadIdGET] Image upload response received.");
                                        res.redirect('/syncweb/pictures/' + req.params.pictureId);
                                    });

                                    response.on('close', function() {
                                        logger.error('[picturesOpFacebookUploadIdGET] 500 Premature closing of the Facebook upload response.');
                                        res.redirect('/500');
                                    });
                                });

                                request.on('error', function(err) {
                                    logger.error('[picturesOpFacebookUploadIdGET] 500 Problem with uploading the picture to Facebook: ' + err);
                                    res.redirect('/500');
                                });

                                request.write(output0);
                                request.write(imageData);
                                request.write(output2);
                                request.end();
                                logger.debug("[picturesOpFacebookUploadIdGET] Image upload request was successful.");
                            }
                        });
                    }
                });
            }
        });
    }
};


// Search all picture filenames for a given string
exports.picturesOpSearchPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/pictures/op/search");
    logger.debug("[picturesOpSearchPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    var searchTerm = req.body.searchTerm.replace(/(["\s'$`\\])/g,'\\$1');
    var expression = new RegExp(searchTerm, "i");

    logger.debug("[picturesOpSearchPOST] Executing search for: " + searchTerm);
    Picture.find({$and: [{share_key: req.currentUser.share_key}, {original_file_name: expression}]}, ['original_file_name', 'file_size'], {sort: [['nameclean', 'ascending']]}, function(err, pictures) {
        if(err) {
            logger.error("[picturesOpSearchPOST] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[picturesOpSearchPOST] Search successful. Passing results accordingly: " + results);
            if(req.params.service == 'syncService') {
                res.json(pictures, HTTP_RESPONSE_SUCCESS_OK);
            } else {
                res.render('pictures/index.jade', {
                    locals : {
                        pictures : pictures,
                        number   : req.currentUser.number,
                        isAdmin  : req.currentUser.isAdmin
                    },
                    layout : 'with_user_info_layout'
                });
            }
        }
    });
};
