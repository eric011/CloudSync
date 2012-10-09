// Require modules
var crypto   = require('crypto');
var mongoose = require('mongoose');
var logger   = require('./logger.js');
var Schema   = mongoose.Schema;
var ObjectId = Schema.ObjectId;

// Functions
function id() {
    return this._id.toHexString();
}

// Contact Schema
var NumbersSchema = new Schema({
    "type"   : String,
    "number" : String
}, {collection: "syncService_ContactsNumbers"});

var EmailsSchema = new Schema({
    "type"  : String,
    "email" : String
}, {collection: "syncService_ContactsEmails"});

var ContactSchema = new Schema({
    "id"         : {type: ObjectId, get: id},
    "name"       : String,
    "nameclean"  : {type: String, index: true},
    //"number"     : String,
    //"email"      : String,
    "numbers"    : [ NumbersSchema ],
    "emails"     : [ EmailsSchema ],
    "share_key"  : String,
    "android_id" : String
}, {collection: "syncService_Contacts"});

ContactSchema.statics.findByShareKey = function (shareKey, callback) {
    return this.find({share_key:shareKey}, callback);
};


// Login Token Schema
var LoginToken = new Schema({
    "number" : {type: String, index: true},
    "series" : {type: String, index: true},
    "token"  : {type: String, index: true}
});

LoginToken.statics.findByNumber = function(number, callback) {
    return this.find({number: number}, callback);
};

LoginToken.method('randomToken', function() {
    return Math.round((new Date().valueOf() * Math.random())) + '';
});

LoginToken.pre('save', function(next) {
    // Automatically create the tokens
    this.token = this.randomToken();

    if (this.isNew) {
        this.series = this.randomToken();
    }

    next();
});

LoginToken.virtual('id').get(function() {
    return this._id.toHexString();
});

LoginToken.virtual('cookieValue').get(function() {
    return JSON.stringify({number: this.number, token: this.token, series: this.series});
});


// Picture Schema
var PictureSchema = new Schema({
    "id"                 : {type: ObjectId, get: id},
    "file_path"          : {type: String, unique: true},
    "original_file_name" : String,
    "file_size"          : String,
    "share_key"          : String
}, {collection: "syncService_Pictures"});

PictureSchema.statics.findByShareKey = function(shareKey, callback) {
    return this.find({share_key: shareKey}, callback);
};

PictureSchema.statics.findById = function(id, callback) {
    return this.find({id: id}, callback);
};

// SMS Schema
var SmsSchema = new Schema({
    "id"        : {type: ObjectId, get: id},
    "Number"    : String,
    "Type"      : Number,
    "Message"   : String,
    "Timestamp" : {type: Number, index: true},
    "share_key" : String
}, {collection: "syncService_Sms"});

SmsSchema.statics.findByShareKey = function(shareKey, callback) {
    return this.find({share_key: shareKey}, callback);
};

// User Account Schema
var UserAccountSchema = new Schema({
    "id"              : {type: ObjectId, get: id},
    "number"          : String,
    "email"           : String,
    "isAdmin"         : {type: Boolean, default: false},
    "hashed_password" : String,
    "password"        : {type: String, get: getPassword, set: setPassword},
    "salt"            : String,
    "share_key"       : String,
    "lastBackupTime"  : {type: Date, default: Date.now},
    "pageSize"        : {type: Number, default: 50}
}, {collection: "syncAccounts"});

UserAccountSchema.statics.findByNumber = function(number, callback) {
    return this.find({number: number}, callback);
};

UserAccountSchema.statics.findByShareKey = function(shareKey, callback) {
    return this.find({share_key: shareKey}, callback);
};

UserAccountSchema.methods.authenticate = function(plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
};

UserAccountSchema.methods.makeSalt = function() {
    return Math.round((new Date().valueOf() * Math.random())) + '';
};

UserAccountSchema.methods.encryptPassword = function(password) {
    var hmacObj = crypto.createHmac('sha1', this.salt).
                  update(password).digest('hex');
    logger.info(hmacObj);
    return hmacObj;
};

function getPassword() {
    return this._password;
}

function setPassword(password) {
    this._password       = password;
    this.salt            = this.makeSalt();
    this.hashed_password = this.encryptPassword(password);
}


// Make our schema and dbs available to other modules
mongoose.model('Contact',     ContactSchema);
mongoose.model('Numbers',     NumbersSchema);
mongoose.model('Emails',      EmailsSchema);
mongoose.model('Sms',         SmsSchema);
mongoose.model('Picture',     PictureSchema);
mongoose.model('UserAccount', UserAccountSchema);
mongoose.model('LoginToken',  LoginToken);

exports.Contact = function(db) {
    return db.model('Contact');
};

exports.Sms = function(db) {
    return db.model('Sms');
};

exports.Picture = function(db) {
    return db.model('Picture');
};

exports.UserAccount = function(db) {
    return db.model('UserAccount');
};
exports.LoginToken = function(db) {
    return db.model('LoginToken');
};
