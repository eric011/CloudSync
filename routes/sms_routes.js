var csv    = require('csv');
var fs     = require('fs');
var path   = require('path');
var logger = require('../logger.js');

var SMS;

var HTTP_RESPONSE_SUCCESS_OK               = 200;
var HTTP_RESPONSE_SUCCESS_CREATED          = 201;
var HTTP_RESPONSE_SUCCESS_NO_CONTENT       = 204;
var HTTP_RESPONSE_SUCCESS_RESET_CONTENT    = 205;
var HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST = 400;
var HTTP_RESPONSE_SERVER_ERROR             = 500;
var HTTP_RESPONSE_NOT_IMPLEMENTED          = 501;

var outputdir  = __dirname + '/../../tempdir/';
var prevOffset = 0;



exports.setSMSModel = function(db) {
    SMS = require('../models.js').Sms(db);
    return SMS;
};



// GET all SMS belonging to current user
exports.smsGET = function (req, res) {
    logger.info("GET /" + req.params.service + "/sms");
    logger.debug("[smsGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        SMS.find({share_key: req.currentUser.share_key}, ['Number', 'Type', 'Message', 'Timestamp'], {sort: [['Timestamp', 'descending']]}, function(err, results) {
            if(err) {
                logger.error("[smsGET] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[smsGET] Results are: " + results);
                res.json(results, HTTP_RESPONSE_SUCCESS_OK);
            }
        });
    } else {
        logger.debug("[smsGET] Redirect to paginated SMS GET.");
        res.redirect('/syncweb/sms/op/' + req.currentUser.pageSize + '/' + prevOffset);
    }
};

// GET :size SMSs from the server, starting at sms :offset
exports.smsOpSizeOffsetGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/sms/op/" + req.params.size + "/" + req.params.offset);
    logger.debug("[smsOpSizeOffsetGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    prevOffset = req.params.offset;

    SMS.find({share_key : req.currentUser.share_key}, ['Number', 'Type', 'Message', 'Timestamp'], {sort: [['Timestamp', 'descending']], skip : req.params.offset, limit : req.params.size}, function(err, smss) {
        if(err) {
            logger.error("[smsOpSizeOffsetGET] 500 Database search error #1: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            SMS.find({share_key : req.currentUser.share_key}).count(function(err, count) {
                if(err) {
                    logger.error("[smsOpSizeOffsetGET] 500 Database search error #2: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        res.redirect('/500');
                    }
                } else {
                    if(req.params.service == 'syncService') {
                        var remaining = count - req.params.size - req.params.offset;

                        if(remaining < 0) {
                            remaining = 0;
                        }

                        var retPage = JSON.parse(JSON.stringify({
                            remaining : remaining,
                            data      : smss
                        }));

                        logger.debug("[smsOpSizeOffsetGET] Results are: " + JSON.stringify(retPage));
                        res.json(retPage, HTTP_RESPONSE_SUCCESS_OK);
                    } else {
                        var pageSize = parseInt(req.params.size, "10");
                        var next     = parseInt(req.params.offset, "10") + pageSize;
                        var prev     = parseInt(req.params.offset, "10") - pageSize;

                        if(next >= count) {
                            next = 0;
                        }

                        logger.debug("[smsOpSizeOffsetGET] Rendering results: " + smss);
                        res.render('sms/index-paginated.jade', {
                            locals : {
                                smss     : smss,
                                number   : req.currentUser.number,
                                isAdmin  : req.currentUser.isAdmin,
                                pageSize : pageSize,
                                next     : next,
                                prev     : prev
                            },
                            layout : 'with_user_info_layout'
                        });
                    }
                }
            });
        }
    });
};

// Set all server SMS as in POST data
exports.smsPOST = function (req, res) {
    logger.info("POST /" + req.params.service + "/sms");
    logger.debug("[smsPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        SMS.findByShareKey(req.currentUser.share_key, function(err, results) {
            if(err) {
                logger.error("[smsPOST] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[smsPOST] Going to remove " + results.length + "SMSs before adding new ones.");
                smsCreator(0);

                /**
                smsRemover(0);

                function smsRemover(i) {
                    if(i < results.length) {
                        results[i].remove(function(err) {
                            if(err) {
                                logger.error("[smsPOST] 400 There was an issue removing the #" + i + " SMS from the database: " + err);
                                res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                            } else {
                                smsRemover(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[smsPOST] Going to add " + req.body.length + "new SMSs.");
                        smsCreator(0);
                    }
                }
                 */

                function smsCreator(i) {
                    if(i < req.body.length) {
                        var sms       = new SMS(req.body[i]);
                        sms.share_key = req.currentUser.share_key;

                        sms.save(function(err) {
                            if(err) {
                                logger.error("[smsPOST] 500 There was an issue saving one of the sent SMSs: " + sms.Timestamp + ", " + err);
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                smsCreator(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[smsPOST] POST was successful.");
                        res.send(HTTP_RESPONSE_SUCCESS_CREATED);
                        require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                    }
                }
            }
        });
    } else {
        logger.error("[smsPOST] 501 Trying to hit smsPOST route from syncweb");
        res.redirect('/501');
    }
};

// POST a paginated list of SMSs (syncService) to the server
exports.smsOpPagedPOST = function (req, res) {
    logger.info("POST /" + req.params.service + "/sms/op/paged");
    logger.debug("[smsOpPagedPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        if(req.body.firstpage == true) {
            SMS.findByShareKey(req.currentUser.share_key, function(err, results) {
                if(err) {
                    logger.error("[smsOpPagedPOST] 500 Database search error: " + err);
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    logger.debug("[smsOpPagedPOST] Going to remove " + results.length + "SMSs before adding new ones.");
                    smsRemover(0);

                    function smsRemover(i) {
                        if(i < results.length) {
                            results[i].remove(function(err) {
                                if(err) {
                                    logger.error("[smsOpPagedPOST] 500 There was an issue removing the #" + i + " sms: " + err);
                                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                                } else {
                                    smsRemover(i + 1);
                                }
                            });
                        } else {
                            logger.debug("[smsOpPagedPOST] Going to add " + req.body.data.length + "new SMSs.");
                            smsCreator(0);
                        }
                    }
                }
            });
        } else {
            logger.debug("[smsOpPagedPOST] Going to add " + req.body.data.length + "new SMSs.");
            smsCreator(0);
        }

        function smsCreator(i) {
            if(i < req.body.data.length) {
                var sms       = new SMS(req.body.data[i]);
                sms.share_key = req.currentUser.share_key;
                sms.save(function(err) {
                    if(err) {
                        logger.error("[smsOpPagedPOST] 500 There was an issue saving one of the sent SMSs: " + sms.Timestamp + ", " + err);
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        smsCreator(i + 1);
                    }
                });
            } else {
                logger.debug("[smsOpPagedPOST] POST was successful.");
                require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                res.send(HTTP_RESPONSE_SUCCESS_CREATED);
            }
        }
    } else {
        logger.error("[smsOpPagedPOST] 501 Paginated SMS POST not implemented for syncweb");
        res.redirect('/500');
    }
};

// Delete all SMS on server
exports.smsDEL = function (req, res) {
    logger.info("DELETE /" + req.params.service + "/sms");
    logger.debug("[smsDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    SMS.findByShareKey(req.currentUser.share_key, function(err, results) {
        if(err) {
            logger.error("[smsDEL] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[smsDEL] Going to remove " + results.length + "SMSs.");
            smsRemover(0);

            function smsRemover(i) {
                if(i < results.length) {
                    results[i].remove(function(err) {
                        if(err) {
                            logger.error("[smsDEL] 400 There was an issue removing the #" + i + " SMS from the database: " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                            } else {
                                res.redirect('/400');
                            }
                        } else {
                            smsRemover(i + 1);
                        }
                    });
                } else {
                    logger.debug("[smsDEL] DEL was successful.");
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                    } else {
                        res.redirect('/syncweb/sms');
                    }
                }
            }
        }
    });
};


// GET single SMS from the server
exports.smsIdGET = function (req, res) {
    logger.info("GET /" + req.params.service + "/sms/" + req.params.smsId);
    logger.debug("[smsIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    SMS.findOne({share_key:req.currentUser.share_key, id:req.params.smsId}, ['Number', 'Type', 'Message', 'Timestamp'], function(err, results) {
        if(err) {
            logger.error("[smsIdGET] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[smsIdGET] Returning the result: " + results);
            if(req.params.service == 'syncService') {
                res.json(results, HTTP_RESPONSE_SUCCESS_OK);
            } else {
                res.redirect('/syncweb/sms');
            }
        }
    });
};

// Set single server SMS as on device
exports.smsIdPUT = function (req, res) {
    logger.info("PUT /" + req.params.service + "/sms/" + req.params.smsId);
    logger.debug("[smsIdPUT]: " + req.currentUser.id + ", " + req.currentUser.number);

    logger.debug("[smsIdGET] Finding the existing SMS: " + req.params.smsId);
    SMS.findOne({_id: req.params.smsId, share_key: req.currentUser.share_key}, function(err, sms) {
        if(err) {
            logger.error("[smsIdPUT] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[smsIdGET] Going to remove the existing SMS Id: " + sms.id);
            sms.remove(function(err) {
                if(err) {
                    logger.error("[smsIdPUT] 500 Error with removing SMS from database: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        res.redirect('/500');
                    }
                } else {
                    jsonObject           = req.body;
                    jsonObject.share_key = req.currentUser.share_key;
                    jsonObject.id        = req.params.smsId;
                    var sms              = new SMS(jsonObject);

                    logger.debug("[smsIdGET] Going to save new SMS with Id: " + smd.id);
                    sms.save(function(err) {
                        if(err) {
                            logger.error("[smsIdPUT] 400 There was an issue saving the sent sms: " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                            } else {
                                res.redirect('/400');
                            }
                        } else {
                            logger.debug("[smsIdGET] The save was successful for SMS Id: " + smd.id);
                            if(req.params.service == "syncService") {
                                res.json(jsonObject, HTTP_RESPONSE_SUCCESS_OK);
                            } else {
                                res.redirect('/syncweb/sms');
                            }
                            require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                        }
                    });
                }
            });
        }
    });
};

// Delete single server SMS
exports.smsIdDEL = function (req, res) {
    logger.info("DELETE /" + req.params.service + "/sms/" + req.params.smsId);
    logger.debug("[smsIdDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    logger.debug("[smsIdDEL] Find the SMS: " + req.params.smsId);
    SMS.findOne({_id: req.params.smsId, share_key: req.currentUser.share_key}, function(err, sms) {
        if(err) {
            logger.error("[smsIdDEL] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            sms.remove(function(err) {
                if(err) {
                    logger.error("[smsIdDEL] 500 Problem removing SMS from database: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        res.redirect('/500');
                    }
                } else {
                    logger.debug("[smsIdDEL] The delete was successful.");
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                    } else {
                        res.redirect('/syncweb/sms');
                    }
                }
            });
        }
    });
};


// Download all SMSs in CSV file format
exports.smsOpDlGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/sms/op/dl");
    logger.debug("[smsOpDlGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[smsOpDlGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        SMS.find({share_key: req.currentUser.share_key}, ['Number', 'Type', 'Message', 'Timestamp'], {sort: [['Timestamp', 'descending']]}, function(err, smss) {
            if(err) {
                logger.error("[smsOpDlGET] 500 Database search error: " + err);
                res.redirect('/500');
            } else if (smss.length == 0) {
                logger.warn("[smsOpDlGET] No SMSs.");
                res.redirect("/syncweb/sms");
            } else {
                // This check may be redundant, if the directory is created on deployment
                logger.debug("[smsOpDlGET] Ensuring the outputdir exists and has the correct permissions: " + outputdir);
                fs.stat(outputdir, function(err, stats) {
                    if(err && err.errno == 34) {
                        fs.mkdir(outputdir, function(err) {
                            if(err) {
                                logger.error("[smsOpDlGET] 500 Creating the outputdir failed: " + err);
                                res.redirect('/500');
                            } else {
                                mkOutput();
                            }
                        });
                    } else if(!err) {
                        mkOutput();
                    } else {
                        logger.error("[smsOpDlGET] 500 There was an issue with the outputdir: " + err);
                        res.redirect('/500');
                    }
                });

                // Creates the SMS output CSV file
                function mkOutput() {
                    var now  = Date.now();
                    var data = JSON.parse(JSON.stringify(smss));
                    csv()
                        .from(data)
                        .toPath(outputdir + req.currentUser.id + now + 'SMS.out', {columns: ['Number','Type','Message','Timestamp']})
                        .on('end',function(count) {
                            var filepath = path.normalize(outputdir + req.currentUser.id + now + 'SMS.out');
                            logger.debug("[smsOpDlGET] Opening download window for SMS.out file at: " + filepath);
                            res.download(filepath, 'SMS.out', function(err) {
                                if(err) {
                                    logger.error("[smsOpDlGET] 500 Problem with downloading SMS CSV file: " + err);
                                    res.redirect('/500');
                                } else {
                                    logger.debug("[smsOpDlGET] Deleting the temp SMS.out CSV file");
                                    fs.unlink(filepath, function(err) {
                                        if(err) {
                                            logger.error("[smsOpDlGET] 500 Problem deleting temporary SMS CSV file: " + err);
                                            res.redirect('/500');
                                        } else {
                                            logger.debug("[smsOpDlGET] SMS.out CSV file operation was successful.");
                                        }
                                    });
                                }
                            });
                        })
                        .on('error',function(error) {
                            logger.error("[smsOpDlGET] 500 SMS CSV creation failure: " + err);
                            res.redirect('/500');
                        });
                }
            }
        });
    }
};


// Search all SMSs for the given search term
exports.smsOpSearchPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/sms/op/search");
    logger.debug("[smsOpSearchPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    var searchTerm = req.body.searchTerm.replace(/(["\s'$`\\])/g,'\\$1');
    var expression = new RegExp(searchTerm, "i");

    logger.debug("[smsOpSearchPOST] Executing search for: " + searchTerm);
    SMS.find({$and: [{share_key: req.currentUser.share_key}, {$or: [{Number : expression}, {Message : expression}]}]}, ['Number', 'Type', 'Message', 'Timestamp'], {sort: [['Timestamp', 'descending']]}, function(err, results) {
        if(err) {
            logger.error("[smsOpSearchPOST] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[smsOpSearchPOST] Search successful. Passing results accordingly: " + results);
            if(req.params.service == 'syncService') {
                res.json(results, HTTP_RESPONSE_SUCCESS_OK);
            } else {
                res.render('sms/index.jade', {
                    locals : {
                        smss    : results,
                        number  : req.currentUser.number,
                        isAdmin : req.currentUser.isAdmin
                    },
                    layout : 'with_user_info_layout'
                });
            }
        }
    });
};

// Set a bunch of test data for the given share_key
exports.populate = function (req, res) {
    logger.info("GET /populatesmss" + req.params.shareKey);
    logger.debug("[populate SMS]");

    var shareKey  = req.params.shareKey;
    var amount    = 1000;
    var randSelection;
    var timeStamp = 01012000000143;

    smsCreator(0);

    function smsCreator(i) {
        if(i < amount) {
            randSelection = Math.floor(Math.random() * 3);
            timeStamp     = timeStamp + 50;

            var sms       = new SMS();
            sms.Number    = "111" + i;
            sms.Type      = randSelection;
            sms.Message   = "Test Message #" + i;
            sms.Timestamp = timeStamp;
            sms.share_key = shareKey;
            sms.save(function(err) {
                if(err) {
                    logger.error("[populate SMS] Saving sms error: " + sms.Number);
                    res.redirect('/500');
                } else {
                    smsCreator(i + 1);
                }
            });
        } else {
            res.redirect('/500');
        }
    }
};
