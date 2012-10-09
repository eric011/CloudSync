// Nodetime for performance tracking
require('nodetime').profile({
    accountKey : 'cc12e02d81b30ccb74e8e838b32d7b3831a10f5b',
    appName    : 'sync-service'
});


/*
 * Module dependencies.
 */

var express         = require('express');
var form            = require("express-form");
var mongoose        = require('mongoose');
var MongooseStore   = require('express-mongodb')(express);
var logger          = require('./logger.js');
var contacts        = require('./routes/contact_routes.js');
var pictures        = require('./routes/picture_routes.js');
var sms             = require('./routes/sms_routes.js');
var userAccounts    = require('./routes/user_account_routes.js');

var field           = form.field;
var Session         = mongoose.model('Session');

var HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST  = 400;
var HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED = 401;
var HTTP_RESPONSE_SERVER_ERROR              = 500;
var HTTP_RESPONSE_NOT_IMPLEMENTED           = 501;

var db;

var app = module.exports = express.createServer();



// Configuration
app.configure('development', function() {
    app.use(express.errorHandler({dumpExceptions:true, showStack:true}));
    app.set('db-uri', 'mongodb://localhost/test');
    app.set('view options', {
        pretty: true
    });
});

app.configure('production', function() {
    app.use(express.errorHandler());
    app.set('db-uri', 'mongodb://localhost/prod');
});

app.configure(function() {
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.use("/assets", express.static(__dirname + '/assets'));
    app.use("/output", express.static(__dirname + '/../tempdir'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser());
    app.use(express.session({
        cookie : {maxAge: 120000},
        secret : "mv secret",
        store  :  new MongooseStore()
    }));
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

db              = mongoose.connect(app.set('db-uri'));
app.Contact     = contacts.setContactModel(db);
app.Picture     = pictures.setPictureModel(db);
app.SMS         = sms.setSMSModel(db);
app.UserAccount = userAccounts.setUserAccountModel(db);
app.LoginToken  = LoginToken = mongoose.model('LoginToken');



// Authentication
// TODO: Check for expired loginToken??
function authenticateFromLoginToken(req, res, next) {
    var cookie = JSON.parse(req.cookies.logintoken);
    logger.info("[authenticateFromLoginToken] with cookie (number, series, token): " + cookie.number + ", " + cookie.series + ", " + cookie.token);

    app.LoginToken.findOne({number: cookie.number, series: cookie.series, token: cookie.token }, function(err, token) {
        if(err) {
            logger.error("[authenticateFromLoginToken] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else if(!token) {
            logger.warn("[authenticateFromLoginToken] 400 No matching token exists");
            if(req.params.service == "syncService") {
                res.send(HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED);
            } else {
                res.redirect('/syncweb/sessions/new');
            }
        } else {
            app.UserAccount.findOne({number: token.number}, function(err, user) {
                if(err) {
                    logger.error("[authenticateFromLoginToken] 500 Database search error: " + err);
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        res.redirect('/500');
                    }
                } else if(!user) {
                    logger.error("[authenticateFromLoginToken] 400 No user exists matching that logintoken");
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                    } else {
                        res.redirect('/400');
                    }
                } else {
                    logger.debug("[authenticateFromLoginToken] New logintoken created for userid " + user.id);
                    req.session.user_id = user.id;
                    req.currentUser     = user;

                    token.token = token.randomToken();
                    token.save(function(err) {
                        if(err) {
                            logger.error("[authenticateFromLoginToken] 400 Problem saving the new token for userid " + user.id + " : " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                            } else {
                                res.redirect('/400');
                            }
                        } else {
                            logger.debug("[authenticateFromLoginToken] New token set for userid " + user.id);
                            res.cookie('logintoken', token.cookieValue, {expires: new Date(Date.now() + 2 * 604800000), path: '/'});
                            next();
                        }
                    });
                }
            });
        }
    });
}

function loadUser(req, res, next) {
    logger.info('[loadUser]');
    if(req.session.user_id) {
        logger.debug('[loadUser] Attempting to authenticate from session user: ' + req.session.user_id);
        app.UserAccount.findById(req.session.user_id, function(err, user) {
            if(err) {
                logger.error("[loadUser] 500 Database search error: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug('[loadUser] User loaded successfully: ' + user.number);
                req.currentUser = user;
                next();
            }
        });
    } else if(req.cookies.logintoken) {
        logger.debug('[loadUser] Attempting to authenticate from logintoken');
        authenticateFromLoginToken(req, res, next);
    } else {
        logger.debug('[loadUser] Unauthorized');
        if(req.params.service == 'syncService') {
            res.send(HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED);
        } else {
            res.redirect('/syncweb/sessions/new');
        }
    }
}

function checkAdminRole(req, res, next) {
    logger.info("[checkAdminRole]: " + req.currentUser.number);
    if(req.currentUser.isAdmin == true) {
        next();
    } else {
        res.send(HTTP_RESPONSE_CLIENT_ERROR_UNAUTHORIZED);
    }
}


// Request handler buffering
function streamBuffer(req, res, next) {
    var self   = this;

    var buffer = [];
    var ended  = false;
    var ondata = null;
    var onend  = null;

    self.ondata = function(f) {
        for(var i = 0; i < buffer.length; i++) {
            f(buffer[i]);
        }
        ondata = f;
    }

    self.onend = function(f) {
        onend = f;
        if(ended) {
            onend();
        }
    }

    req.on('data', function(chunk) {
        if(ondata) {
            ondata(chunk);
        } else {
            buffer.push(chunk);
        }
    });

    req.on('end', function() {
        ended = true;
        if(onend) {
            onend();
        }
    });

    req.streambuffer = self;
    next();
}



/*****************************************************ROUTES*******************************************************/

// Global
app.get('/', function(req, res) {
    logger.info("GET /");

    if(req.params.service == 'syncService') {
        logger.error("501 Trying to hit / from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        res.redirect('/syncweb/sessions/new');
    }
});

app.get('/sessionsCreated', function(req, res) {
    logger.info("GET /sessionsCreated");

    Session.find({}, function(err, sessions) {
        if(err) {
            logger.error("500 Sessions Created failed: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
            } else {
                res.redirect('/500');
            }
        }
        res.send(sessions);
    });
});

// Users
app.post('/:service/users', form(
    field("user.number", "Number").trim().required(),
    field("user.email", "Email").trim(),
    field("user.password", "Password").required(),
    field("user.password2", "Confirm Password").required().equals("field::user.password", "Password confirm does not match password.")
), userAccounts.usersPOST);

app.put('/:service/users', loadUser, form(
    field("user.oldpassword", "Old Password").required(),
    field("user.password", "New Password").required(),
    field("user.password2", "Confirm Password").required().equals("field::user.password", "Password confirm does not match password.")
), userAccounts.usersPUT);
app.del('/:service/users', loadUser, userAccounts.usersDEL);

app.get('/:service/users/new', userAccounts.usersNewGET);

app.put('/:service/users/email', loadUser, form(
    field("user.email", "Email").required()
), userAccounts.usersEmailPUT);
app.put('/:service/users/pageSize', loadUser, form(
    field("user.pageSize", "pageSize").required()
), userAccounts.usersPageSizePUT);

app.get ('/:service/passwordreset', userAccounts.passwordresetGET);
app.post('/:service/passwordreset', form(
    field("user.number", "Number").trim().required()
), userAccounts.passwordresetPOST);

app.post('/:service/passwordresetadmin', form(
    field("user.number", "Number").trim().required()
), userAccounts.passwordresetadminPOST);

// Sessions
app.post('/:service/sessions', form(
    field("user.number", "Number").trim().required(),
    field("user.password", "Password").required()
), userAccounts.sessionsPOST);
app.del ('/:service/sessions', loadUser, userAccounts.sessionsDEL);

app.get('/:service/sessions/new', userAccounts.sessionsNewGET);
app.get('/:service/sessions/check', loadUser, userAccounts.sessionsCheckGET);

// Settings
app.get('/:service/settings', loadUser, userAccounts.settingsGET);

// Backup
app.get('/:service/backup', loadUser, userAccounts.backupGET);

// Admin
app.get('/:service/admin', loadUser, checkAdminRole, userAccounts.adminGET);

// Contacts
app.get ('/:service/contacts', loadUser, contacts.contactsGET);
app.get ('/:service/contacts/op/:size/:offset', loadUser, contacts.contactsOpSizeOffsetGET);
app.post('/:service/contacts', loadUser, form(
    field("contact.name", "Name").trim().required(),
    field("contact.number", "Phone Number").trim(),
    field("contact.email", "Email").trim()
), contacts.contactsPOST);
app.post('/:service/contacts/op/smart', loadUser, contacts.contactsOpSmartPOST);
app.post('/:service/contacts/op/paged', loadUser, contacts.contactsOpPagedPOST);
app.del ('/:service/contacts', loadUser, contacts.contactsDEL);

app.get('/:service/contacts/:contactId',         loadUser, contacts.contactsIdGET);
app.put('/:service/contacts/:contactId',         loadUser, form(
    field("contact.name", "Name").trim().required(),
    field("contact.number", "Phone Number").trim(),
    field("contact.email", "Email").trim()
), contacts.contactsIdPUT);
app.del('/:service/contacts/:contactId',         loadUser, contacts.contactsIdDEL);
app.get('/:service/contacts/:contactId/op/edit', loadUser, contacts.contactsIdOpEditGET);

app.get('/:service/contacts/op/dl',          loadUser, contacts.contactsOpDlGET);
app.get('/:service/contacts/op/new',         loadUser, contacts.contactsOpNewGET);
app.get('/:service/contacts/op/gmailOAuth',  loadUser, contacts.contactsOpGmailOAuthGET);
app.get('/:service/contacts/op/gmailImport', loadUser, contacts.contactsOpGmailImportGET);

app.post('/:service/contacts/op/search', loadUser, contacts.contactsOpSearchPOST);

// SMSs
app.get ('/:service/sms', loadUser, sms.smsGET);
app.get ('/:service/sms/op/:size/:offset', loadUser, sms.smsOpSizeOffsetGET);
app.post('/:service/sms', loadUser, sms.smsPOST);
app.post('/:service/sms/op/paged', loadUser, sms.smsOpPagedPOST);
app.del ('/:service/sms', loadUser, sms.smsDEL);

app.get('/:service/sms/:smsId', loadUser, sms.smsIdGET);
app.put('/:service/sms/:smsId', loadUser, sms.smsIdPUT);
app.del('/:service/sms/:smsId', loadUser, sms.smsIdDEL);

app.get('/:service/sms/op/dl', loadUser, sms.smsOpDlGET);

app.post('/:service/sms/op/search', loadUser, sms.smsOpSearchPOST);

// Pictures
app.get ('/:service/pictures', loadUser, pictures.picturesGET);
app.post('/:service/pictures', streamBuffer, loadUser, pictures.picturesPOST);

app.get('/:service/pictures/:pictureId', loadUser, pictures.picturesIdGET);
app.get('/:service/pictures/:pictureId/op/:length/:offset', loadUser, pictures.picturesIdOpLengthOffsetGET);
app.del('/:service/pictures/:pictureId', loadUser, pictures.picturesIdDEL);

app.get('/:service/pictures/op/dl',                        loadUser, pictures.picturesOpDlGET);
app.get('/:service/pictures/op/dl/:pictureId',             loadUser, pictures.picturesOpDlIdGET);
app.get('/:service/pictures/op/facebookOAuth/:pictureId',  loadUser, pictures.picturesOpFacebookOAuthIdGET);
app.get('/:service/pictures/op/facebookUpload/:pictureId', loadUser, pictures.picturesOpFacebookUploadIdGET);

app.post('/:service/pictures/op/search', loadUser, pictures.picturesOpSearchPOST);

// GMail
app.get('/google57d4c2d6ad5b9b14.html', function(req, res) {
    res.end('google-site-verification: google57d4c2d6ad5b9b14.html');
});

// TEST
app.get('/populatecontacts/:shareKey', contacts.populate);
app.get('/populatesmss/:shareKey',     sms.populate);

/******************************************************************************************************************/



// Error handling
function NotFound(msg){
    this.name = 'NotFound';
    Error.call(this, msg);
    Error.captureStackTrace(this, arguments.callee);
}

NotFound.prototype.__proto__ = Error.prototype;

app.get('/404', function(req, res) {
    logger.info("[404]");
    throw new NotFound;
});

app.get('/500', function(req, res) {
    logger.info("[500]");
    throw new Error('Internal Server Error.');
});
app.get('/501', function(req, res) {
    logger.info("[501]");
    throw new Error('Not implemented.');
});

app.error(function(err, req, res, next) {
    logger.info("[error]: " + err);
    res.json(err.stack, HTTP_RESPONSE_SERVER_ERROR);
    /*
    if(err instanceof NotFound) {
        res.render('error/index.jade', {
            status : 400,
            locals : {
                error   : err,
                number  : '',
                isAdmin : false
            },
            layout : 'with_user_info_layout'
        });
    } else {
        res.render('error/index.jade', {
            status : 500,
            locals : {
                error   : err.stack,
                number  : '',
                isAdmin : false
            },
            layout : 'with_user_info_layout'
        });
    }
    */
});



// Server
app.listen(3000, "127.0.0.1", function() {
    logger.info("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});
