var fs         = require('fs');
var nodemailer = require("nodemailer");
var logger     = require('../logger.js');

var Contact, Picture, SMS, UserAccount;

var HTTP_RESPONSE_SUCCESS_CREATED           = 201;
var HTTP_RESPONSE_SUCCESS_NO_CONTENT        = 204;
var HTTP_RESPONSE_SUCCESS_RESET_CONTENT     = 205;
var HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST  = 400;
var HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED = 401;
var HTTP_RESPONSE_CLIENT_ERROR_NOT_FOUND    = 404;
var HTTP_RESPONSE_SERVER_ERROR              = 500;
var HTTP_RESPONSE_NOT_IMPLEMENTED           = 501;

var outputdir = __dirname + '/../../tempdir/';



// Create reusable transport method (opens pool of SMTP connections)
var smtpTransport = nodemailer.createTransport("SMTP", {
    service: "Gmail",
    auth: {
        user : "zahid@peek.ly",
        pass : "appserver85"
    }
});


exports.setUserAccountModel = function(db) {
    Contact     = require('../models.js').Contact(db);
    Picture     = require('../models.js').Picture(db);
    SMS         = require('../models.js').Sms(db);
    UserAccount = require('../models.js').UserAccount(db);

    return UserAccount;
};


// Generate a random string for use with cookies/passwords
randomString = function() {
    logger.info("[randomString]");

    var chars         = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
    var string_length = 12;
    var rndstring     = '';

    for(var i = 0; i < string_length; i++) {
        var rnum   = Math.floor(Math.random() * chars.length);
        rndstring += chars.substring(rnum, rnum + 1);
    }

    logger.debug("[randomString]: " + rndstring);
    return rndstring;
};


// Ensure that no two users have the same share_key
function checkShareKeyExists(req, res, next) {
    logger.info("[checkShareKeyExists]");

    var shareKey = randomString();

    logger.debug("[checkShareKeyExists]: " + shareKey);
    UserAccount.count({share_key:shareKey}, function(err, count) {
        if(err) {
            logger.error("[checkShareKeyExists] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else if(count) {
            logger.debug("[checkShareKeyExists] It exists. Try again.");
            checkShareKeyExists(req, res, next);
        } else {
            logger.debug("[checkShareKeyExists] Successfully created unique shareKey.");
            next(req, res, shareKey);
        }
    });
}


// Called to reset the current user's password
function resetUserPassword(req, res, renderingJadeTemplate, redirectUrl) {
    logger.info("[resetUserPassword]");

    if(!req.form.isValid && req.params.service == 'syncweb') {
        logger.warn("[resetUserPassword] Errors: " + req.form.errors);
        res.render(renderingJadeTemplate, {
            locals: {
                user   : new UserAccount(),
                errors : req.form.errors
            }
        });
    } else {
        var number = req.body.user.number;

        logger.debug("[resetUserPassword] Finding the account in question: " + number);
        UserAccount.findOne({number: number}, function(err, user) {
            if(err) {
                logger.error("[resetUserPassword] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else if (!user) {
                logger.warn("[resetUserPassword] User account not found.");
                if(req.params.service == 'syncweb') {
                    res.redirect(redirectUrl);
                } else {
                    res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                }
            } else if(!user.email || user.email == '') {
                logger.warn("[resetUserPassword] Email not found for: " + number);
                if(req.params.service == 'syncweb') {
                    res.render(renderingJadeTemplate, {
                        locals : {
                            user   : new UserAccount(),
                            errors : ['No email found for this number. Please send an email to care@peek.ly to reset password.']
                        }
                    });
                } else {
                    res.send(HTTP_RESPONSE_CLIENT_ERROR_NOT_FOUND);
                }
            } else {
                logger.warn("[resetUserPassword] Resetting password for: " + number);

                var newPassword = randomString();
                user.password   = newPassword;

                user.save(function(err) {
                    if(err) {
                        logger.error("[resetUserPassword] 500 Problem saving the updated user: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            res.redirect('/500');
                        }
                    } else {
                        logger.warn("[resetUserPassword] Sending password reset email to: " + user.email);

                        // setup e-mail data with unicode symbols
                        var mailOptions = {
                            from    : "Peek Cloud Sync<peek_cloud_sync@example.com>",
                            to      : user.email,
                            subject : "Peek Cloud Sync Password Reset",
                            text    : "Hi, your new Peek Cloud Sync password is " + newPassword,
                            html    : "<b>Hi, your new Peek Cloud Sync password is " + newPassword + "</b>"
                        };

                        // send mail with defined transport object
                        smtpTransport.sendMail(mailOptions, function(error, response) {
                            if(error) {
                                logger.error("[resetUserPassword] 500 Error sending email: " + err);
                                if(req.params.service == 'syncService') {
                                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                                } else {
                                    res.redirect('/500');
                                }
                            } else {
                                logger.info("[resetUserPassword] Message sent to " + user.email + ": " + response.message);

                                // shut down the connection pool, no more messages
                                smtpTransport.close();

                                if(req.params.service == 'syncweb') {
                                    res.redirect(redirectUrl);
                                } else {
                                    res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                                }
                            }
                        });
                    }
                });
            }
        });
    }
}


// Called when the last backup date should be updated for the current user
exports.updateLastBackupDate = function(userid) {
    logger.info("[updateLastBackupDate]: " + userid);

    UserAccount.findOne({_id: userid}, function(err, user) {
        if(err) {
            logger.error("[updateLastBackupDate] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            user.lastBackupTime = new Date();

            logger.debug("[updateLastBackupDate] New backup time is: " + user.lastBackupTime);
            user.save(function(err) {
                if(err) {
                    logger.error("[updateLastBackupDate] 400 Problem saving the updated user: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                    } else {
                        res.redirect('/400');
                    }
                }
            });
        }
    });
};


// Register a new user account
exports.usersPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/users");
    logger.debug("[usersPOST]");

    if(!req.form.isValid && req.params.service == 'syncweb') {
        logger.warn("[usersPOST] Errors: " + req.form.errors);
        res.render('users/new', {
            locals: {
                user   : new UserAccount(),
                errors : req.form.errors
            }
        });
    } else {
        logger.debug("[usersPOST] Checking if account exists: " + req.body.user.number);
        UserAccount.find({number: req.body.user.number}, function(err, contacts) {
            if(err) {
                logger.error("[usersPOST] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else if(contacts.length != 0) {
                var errors = ["Username already exists. Try again."];
                logger.warn("[usersPOST] Errors: " + errors);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                } else {
                    res.render('users/new', {
                        locals : {
                            user   : new UserAccount(),
                            errors : errors
                        }
                    });
                }
            } else {
                logger.debug("[usersPOST] Creating new account: " + req.body.user.number);

                checkShareKeyExists(req, res, function(req, res, shareKey) {
                    var user = new UserAccount({
                        number   : req.body.user.number,
                        email    : req.body.user.email,
                        password : req.body.user.password
                    });
                    user.share_key = shareKey;
                    user.save(function(err) {
                        if(err) {
                            logger.error("[usersPOST] 400 Problem saving the new user: " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                            } else {
                                res.redirect('/400');
                            }
                        } else {
                            logger.debug("[usersPOST] Saved account: " + user.number + ", " + user.email);

                            req.session.user_id = user.id;
                            if(req.params.service == 'syncService') {
                                res.json({user_id : user.id}, HTTP_RESPONSE_SUCCESS_CREATED);
                            } else {
                                res.redirect('/syncweb/contacts');
                            }
                        }
                    });
                });
            }
        });
    }
};


// Update the current user's password
exports.usersPUT = function(req, res) {
    logger.info("PUT /" + req.params.service + "/users");
    logger.debug("[usersPUT]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncweb' && !req.form.isValid) {
        logger.warn("[usersPUT] Errors: " + req.form.errors);
        res.render('settings/index', {
            locals : {
                user    : req.currentUser,
                number  : req.currentUser.number,
                isAdmin : req.currentUser.isAdmin,
                errors  : req.form.errors,
                errors2 : '',
                errors3 : ''
            },
            layout  : 'with_user_info_layout'
        });
    } else {
        UserAccount.findOne({_id: req.currentUser.id}, function(err, user) {
            if(err) {
                logger.error("[usersPUT] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersPUT] Attempting to authenticate: " + user.id);

                if(!user.authenticate(req.body.user.oldpassword)) {
                    var errors = ["Incorrect password"];
                    logger.warn("[usersPUT] Errors: " + errors);
                    if(req.params.service == 'syncService') {
                        logger.error("400: " + errors);
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                    } else {
                        res.render('settings/index', {
                            locals : {
                                user    : req.currentUser,
                                number  : req.currentUser.number,
                                isAdmin : req.currentUser.isAdmin,
                                errors  : errors,
                                errors2 : '',
                                errors3 : ''
                            },
                            layout  : 'with_user_info_layout'
                        });
                    }
                } else {
                    logger.debug("[usersPUT] Authenticated. Updating: " + user.id);

                    user.password = req.body.user.password;
                    user.save(function(err) {
                        if(err) {
                            logger.error("[usersPUT] 500 Problem saving the updated user: " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                res.redirect('/500');
                            }
                        } else {
                            logger.debug("[usersPUT] Successfully updated: " + user.id);

                            if(req.params.service == 'syncService') {
                                res.json({user_id : user.id}, HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                            } else {
                                res.redirect('/syncweb/settings');
                            }
                        }
                    });
                }
            }
        });
    }
};

// DEL the current user's account
exports.usersDEL = function(req, res) {
    logger.info("DEL /" + req.params.service + "/users");
    logger.debug("[usersDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    logger.debug("[usersDEL] Find all SMSs belonging to: " + req.currentUser.id);
    removeSMSs();

    function removeSMSs() {
        SMS.findByShareKey(req.currentUser.share_key, function(err, results) {
            if(err) {
                logger.error("[usersDEL] 500 SMS Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersDEL] Delete all SMSs belonging to: " + req.currentUser.id);
                smsRemover(0);

                function smsRemover(i) {
                    if(i < results.length) {
                        results[i].remove(function(err) {
                            if(err) {
                                logger.error("[usersDEL] 500 Problem deleting #" + i + " SMS: " + err);
                                smsRemover(i + 1);
                            } else {
                                smsRemover(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[usersDEL] Find all Contacts belonging to: " + req.currentUser.id);
                        removeContacts();
                    }
                }
            }
        });
    }

    function removeContacts() {
        Contact.findByShareKey(req.currentUser.share_key, function(err, results) {
            if(err) {
                logger.error("[usersDEL] 500 Contact Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersDEL] Delete all Contacts belonging to: " + req.currentUser.id);
                contactRemover(0);

                function contactRemover(i) {
                    if(i < results.length) {
                        results[i].remove(function(err) {
                            if(err) {
                                logger.error("[usersDEL] 500 Problem deleting #" + i + " contact: " + err);
                                contactRemover(i + 1);
                            } else {
                                contactRemover(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[usersDEL] Find all Pictures belonging to: " + req.currentUser.id);
                        removePictures();
                    }
                }
            }
        });
    }

    function removePictures() {
        Picture.findByShareKey(req.currentUser.share_key, function(err, results) {
            if (err) {
                logger.error("[usersDEL] 500 Picture Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersDEL] Delete all Pictures belonging to: " + req.currentUser.id);
                pictureRemover(0);

                function pictureRemover(i) {
                    if(i < results.length) {
                        deleteImage();

                        function deleteImage() {
                            fs.unlink(outputdir + results[i].file_path, function(err) {
                                if(err) {
                                    logger.error("[usersDEL] 500 Problem deleting #" + i + " image file: " + err);
                                    deleteThumb();
                                } else {
                                    deleteThumb();
                                }
                            });
                        }

                        function deleteThumb() {
                            fs.unlink(outputdir + '.thumbs/' + results[i].file_path, function(err) {
                                if(err) {
                                    logger.error("[usersDEL] 500 Problem deleting #" + i + " thumbnail file: " + err);
                                    deleteEntry();
                                } else {
                                    deleteEntry();
                                }
                            });
                        }

                        function deleteEntry() {
                            results[i].remove(function(err) {
                                if(err) {
                                    logger.error("[usersDEL] 500 Problem removing the #" + i + " image from the database: " + err);
                                    pictureRemover(i + 1);
                                } else {
                                    pictureRemover(i + 1);
                                }
                            });
                        }
                    } else {
                        logger.debug("[usersDEL] Find logintokens belonging to the user (if any): " + req.currentUser.id);
                        removeTokens();
                    }
                }
            }
        });
    }

    function removeTokens() {
        LoginToken.findByNumber(req.currentUser.number, function(err, results) {
            if(err) {
                logger.error("[usersDEL] 500 LoginToken Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else if(!results) {
                logger.debug("[usersDEL] 400 No matching tokens exist");
                logger.debug("[usersDEL] Find the user: " + req.currentUser.id);
                removeUser();
            } else {
                logger.debug("[usersDEL] Delete the tokens: " + req.currentUser.id);
                tokenRemover(0);

                function tokenRemover(i) {
                    if(i < results.length) {
                        results[i].remove(function(err) {
                            if(err) {
                                logger.error("[usersDEL] 500 Problem deleting #" + i + " token: " + err);
                                tokenRemover(i + 1);
                            } else {
                                tokenRemover(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[usersDEL] Find the user: " + req.currentUser.id);
                        removeUser();
                    }
                }
            }
        });
    }

    function removeUser() {
        UserAccount.findOne({_id: req.currentUser.id}, function(err, user) {
            if(err) {
                logger.error("[usersDEL] 500 UserAccount Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersDEL] Delete the user: " + req.currentUser.id);
                user.remove(function(err) {
                    if(err) {
                        logger.error("[usersDEL] 500 Problem deleting user: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            res.redirect('/500');
                        }
                    } else {
                        logger.debug("[usersDEL] User deleted successfully: " + req.currentUser.id);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                        } else {
                            res.redirect('/syncweb/sessions/new');
                        }
                    }
                });
            }
        });
    }
};


// Load the form for registering a new user
exports.usersNewGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/users/new");
    logger.debug("[usersNewGET]");

    if(req.params.service == "syncService") {
        logger.error("[usersNewGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        logger.debug("[usersNewGET] Now loading.");
        res.render('users/new', {
            locals : {
                user   : new UserAccount(),
                errors : ''
            }
        });
    }
};


// Update the current user's email address
exports.usersEmailPUT = function(req, res) {
    logger.info("PUT /" + req.params.service + "/users/email");
    logger.debug("[usersEmailPUT]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(!req.form.isValid && req.params.service == 'syncweb') {
        logger.warn("[usersEmailPUT] Errors: " + req.form.errors);
        res.render('settings/index', {
            locals : {
                user    : req.currentUser,
                number  : req.currentUser.number,
                errors  : '',
                errors2 : req.form.errors,
                errors3 : '',
                isAdmin : req.currentUser.isAdmin
            },
            layout : 'with_user_info_layout'
        });
    } else {
        UserAccount.findOne({_id: req.currentUser.id}, function(err, user) {
            if(err) {
                logger.error("[usersEmailPUT] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersEmailPUT] Found user, updating email to: " + req.body.user.email);

                user.email = req.body.user.email;
                user.save(function(err) {
                    if(err) {
                        logger.error("[usersEmailPUT] 500 Problem saving the updated user: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            res.redirect('/500');
                        }
                    } else {
                        logger.debug("[usersEmailPUT] Successfully updated user.");
                        if(req.params.service == 'syncService') {
                            res.json({user_id : user.id}, HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                        } else {
                            res.redirect('/syncweb/settings');
                        }
                    }
                });
            }
        });
    }
};

// Update the current user's pageSize
exports.usersPageSizePUT = function(req, res) {
    logger.info("PUT /" + req.params.service + "/users/pageSize");
    logger.debug("[usersPageSizePUT]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(!req.form.isValid && req.params.service == 'syncweb') {
        logger.warn("[usersPageSizePUT] Errors: " + req.form.errors);
        res.render('settings/index', {
            locals : {
                user    : req.currentUser,
                number  : req.currentUser.number,
                errors  : '',
                errors2 : '',
                errors3 : req.form.errors,
                isAdmin : req.currentUser.isAdmin
            },
            layout : 'with_user_info_layout'
        });
    } else {
        UserAccount.findOne({_id: req.currentUser.id}, function(err, user) {
            if(err) {
                logger.error("[usersPageSizePUT] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[usersPageSizePUT] Found user, updating email to: " + req.body.user.pageSize);

                user.pageSize = req.body.user.pageSize;
                user.save(function(err) {
                    if(err) {
                        logger.error("[usersPageSizePUT] 500 Problem saving the updated user: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            res.redirect('/500');
                        }
                    } else {
                        logger.debug("[usersPageSizePUT] Successfully updated user.");

                        if(req.params.service == 'syncService') {
                            res.json({user_id : user.id}, HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                        } else {
                            res.redirect('/syncweb/settings');
                        }
                    }
                });
            }
        });
    }
};


// Load the password reset form
exports.passwordresetGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/passwordreset");
    logger.debug("[passwordresetGET]");

    if(req.params.service == "syncService") {
        logger.error("[passwordresetGET] 501 Trying to hit passwordresetGET route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else if(req.currentUser) {
        logger.debug("[passwordresetGET] Loading form for live session.");
        res.render('sessions/passwordreset', {
            locals : {
                user    : new UserAccount(),
                isAdmin : req.currentUser.isAdmin,
                errors  : ''
            }
        });
    } else {
        logger.debug("[passwordresetGET] Loading form for new session.");
        res.render('sessions/passwordreset', {
            locals : {
                user    : new UserAccount(),
                isAdmin : false,
                errors  : ''
            }
        });
    }
};

// Allows an individual to reset their own password
exports.passwordresetPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/passwordreset");
    logger.debug("[passwordresetPOST]");

    resetUserPassword(req, res, 'sessions/passwordreset', '/syncweb/sessions/new');
};


// Called when an admin wants to reset any user's password
exports.passwordresetadminPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/passwordresetadmin");
    logger.debug("[passwordresetadminPOST]");

    if(req.params.service == "syncService") {
        logger.error("[passwordresetadminPOST] 501 Trying to hit passwordresetadminPOST route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        resetUserPassword(req, res, 'admin/index', '/syncweb/admin');
    }
};


// Registers a new session
exports.sessionsPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/sessions");
    logger.debug("[sessionsPOST]: " + req.form.user.number + ", " + req.form.user.password);

    if (!req.form.isValid && req.params.service == 'syncweb') {
        logger.warn("[sessionsPOST] Errors: " + req.form.errors);
        res.render('sessions/new', {
            locals : {
                user   : new UserAccount(),
                errors : req.form.errors
            }
        });
    } else {
        UserAccount.findOne({number: req.form.user.number}, function(err, user) {
            if(err) {
                logger.error("[sessionsPOST] 500 Problem finding the user: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                if(user && user.authenticate(req.form.user.password)) {
                    logger.debug("[sessionsPOST] Authenticated user: " + user.id);

                    req.session.user_id = user.id;
                    if(req.params.service == 'syncService') {
                        logger.debug("[sessionsPOST] Handling authentication for syncService: " + user.id);

                        var loginToken = new LoginToken({number: user.number});
                        loginToken.save(function(err) {
                            if(err) {
                                logger.error("[sessionsPOST] 500 Problem saving the login token: " + err);
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                res.cookie('logintoken', loginToken.cookieValue, {expires: new Date(Date.now() + 2 * 604800000), path: '/'});
                                res.json({logintoken: encodeURIComponent(loginToken.cookieValue)}, HTTP_RESPONSE_SUCCESS_CREATED);
                            }
                        });
                    } else {
                        logger.debug("[sessionsPOST] Handling authentication for syncweb: " + user.id);

                        if(req.body.remember_me) {
                            logger.debug("[sessionsPOST] Create a cookie if remember me is checked.");

                            var loginToken = new LoginToken({number: user.number});
                            loginToken.save(function(err) {
                                if(err) {
                                    logger.error("[sessionsPOST] 500 Problem saving the login token: " + err);
                                    res.redirect('/500');
                                } else {
                                    logger.debug("[sessionsPOST] Cookie saved successfully.");
                                    res.cookie('logintoken', loginToken.cookieValue, {expires: new Date(Date.now() + 2 * 604800000), path: '/'});
                                    res.redirect('/syncweb/contacts');
                                }
                            });
                        } else {
                            res.redirect('/syncweb/contacts');
                        }
                    }
                } else {
                    var errors = ["Incorrect username and/or password"];
                    logger.warn("[sessionsPOST] Errors: " + errors);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED);
                    } else {
                        res.render('sessions/new', {
                            locals : {
                                user   : new UserAccount(),
                                errors : errors
                            }
                        });
                    }
                }
            }
        });
    }
};

// Destroys the current session
exports.sessionsDEL = function(req, res) {
    logger.info("DELETE /" + req.params.service + "/sessions");
    logger.debug("[sessionsDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    LoginToken.remove({number: req.currentUser.number}, function(err) {
        if(err) {
            logger.error("[sessionsDEL] 500 Problem deleting the current login token: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[sessionsDEL] Removed logintoken from db.");

            res.clearCookie('logintoken');
            req.session.destroy(function(err) {
                if(err) {
                    logger.error("[sessionsDEL] 500 Problem deleting the current session: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        res.redirect('/500');
                    }
                } else {
                    logger.debug("[sessionsDEL] Session destroyed successfully.");
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                    } else {
                        res.redirect('/syncweb/sessions/new');
                    }
                }
            });
        }
    });
};


// Load the new session form
exports.sessionsNewGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/sessions/new");
    logger.debug("[sessionsNewGET]");

    if(req.params.service == "syncService") {
        logger.error("[sessionsNewGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        if(req.session) {
            if(req.currentUser) {
                logger.debug("[sessionsNewGET] Remove the logintoken if one exists.");
                LoginToken.remove({number: req.currentUser.number}, function(err) {
                    if(err) {
                        logger.error("[sessionsNewGET] 500 Problem deleting the current logintoken: " + err);
                        res.redirect('/500');
                    } else {
                        clearSession();
                    }
                });
            } else {
                clearSession();
            }

            function clearSession() {
                logger.debug("[sessionsNewGET] Destroy the session if one exists.");

                res.clearCookie('logintoken');
                req.session.destroy(function(err) {
                    if(err) {
                        logger.error("[sessionsNewGET] 500 Problem deleting the current session: " + err);
                        res.redirect('/500');
                    } else {
                        logger.debug("[sessionsNewGET] Load new session form.");
                        res.render('sessions/new', {
                            locals : {
                                user   : new UserAccount(),
                                errors : ''
                            }
                        });
                    }
                });
            }
        } else {
            logger.debug("[sessionsNewGET] Load new session form.");
            res.render('sessions/new', {
                locals : {
                    user   : new UserAccount(),
                    errors : ''
                }
            });
        }
    }
};

// Load the settings page for the current user
exports.sessionsCheckGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/sessions/check");
    logger.debug("[sessionsCheckGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[sessionsCheckGET] 204 The session is valid.");
        res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
    } else {
        logger.debug("[sessionsCheckGET] 501 Trying to hit the route from syncweb");
        res.redirect('/500');
    }
};


// Load the settings page for the current user
exports.settingsGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/settings");
    logger.debug("[settingsGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[settingsGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        logger.debug("[settingsGET] Load the page.");
        res.render('settings/index', {
            locals : {
                user    : req.currentUser,
                number  : req.currentUser.number,
                errors  : '',
                errors2 : '',
                errors3 : '',
                isAdmin : req.currentUser.isAdmin
            },
            layout : 'with_user_info_layout'
        });
    }
};


// Load the backup status page for the current user
exports.backupGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/backup");
    logger.debug("[backupGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[backupGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        var backupTimestamp = req.currentUser.lastBackupTime.toUTCString();

        logger.debug("[settingsGET] Load the page. Last backed up: " + backupTimestamp);
        res.render('backup/index', {
            locals : {
                user            : req.currentUser,
                number          : req.currentUser.number,
                isAdmin         : req.currentUser.isAdmin,
                backupTimeStamp : backupTimestamp
            },
            layout : 'with_user_info_layout'
        });
    }
};


// Load the admin panel for the current admin user
exports.adminGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/admin");
    logger.debug("[adminGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[adminGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        logger.debug("[adminGET] Load the page.");
        res.render('admin/index', {
            locals : {
                user    : req.currentUser,
                number  : req.currentUser.number,
                isAdmin : req.currentUser.isAdmin,
                errors  : ''
            },
            layout : 'with_user_info_layout'
        });
    }
};
