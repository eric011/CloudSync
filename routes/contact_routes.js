var csv             = require('csv');
var fs              = require('fs');
var path            = require('path');
var oauth           = require('oauth');
var request         = require('request');
var logger          = require('../logger.js');

var Contact;
var oa;
var MAX_NUM_CONTACTS_FOR_GMAIL = 25000;         //http://support.google.com/mail/bin/answer.py?hl=en&answer=148779

var HTTP_RESPONSE_SUCCESS_OK               = 200;
var HTTP_RESPONSE_SUCCESS_CREATED          = 201;
var HTTP_RESPONSE_SUCCESS_NO_CONTENT       = 204;
var HTTP_RESPONSE_SUCCESS_RESET_CONTENT    = 205;
var HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST = 400;
var HTTP_RESPONSE_SERVER_ERROR             = 500;
var HTTP_RESPONSE_NOT_IMPLEMENTED          = 501;

var outputdir  = __dirname + '/../../tempdir/';
var appaddress = 'http://cloudsync.peeknet.net';
//var appaddress = 'http://localhost:3000';
var prevOffset = 0;


exports.setContactModel = function(db) {
    Contact = require('../models.js').Contact(db);
    return Contact;
};

// GET all contacts from the server
exports.contactsGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts");
    logger.debug("[contactsGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        Contact.find({share_key: req.currentUser.share_key}, ['name', 'numbers', 'emails', 'android_id'], {sort: [['nameclean', 'ascending']]}, function(err, contacts) {
            if(err) {
                logger.error("[contactsGET] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[contactsGET] Contacts sent to client: " + JSON.stringify(contacts));
                res.json(contacts, HTTP_RESPONSE_SUCCESS_OK);
            }
        });
    } else {
        res.redirect('/syncweb/contacts/op/' + req.currentUser.pageSize + '/' + prevOffset);
    }
};

// GET :size contacts from the server, starting at contact :offset
exports.contactsOpSizeOffsetGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/op/" + req.params.size + "/" + req.params.offset);
    logger.debug("[contactsOpSizeOffsetGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    prevOffset = req.params.offset;

    Contact.find({share_key : req.currentUser.share_key}, ['name', 'numbers', 'emails', 'android_id'], {sort : [['nameclean', 'ascending']], skip : req.params.offset, limit : req.params.size}, function(err, contacts) {
        if(err) {
            logger.error("[contactsOpSizeOffsetGET] 500 Database search error #1: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            Contact.find({share_key : req.currentUser.share_key}).count(function(err, count) {
                if(err) {
                    logger.error("[contactsOpSizeOffsetGET] 500 Database search error #2: " + err);
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
                            data      : contacts
                        }));

                        logger.debug("[contactsOpSizeOffsetGET] Results are: " + JSON.stringify(retPage));
                        res.json(retPage, HTTP_RESPONSE_SUCCESS_OK);
                    } else {
                        var pageSize = parseInt(req.params.size, "10");
                        var next     = parseInt(req.params.offset, "10") + pageSize;
                        var prev     = parseInt(req.params.offset, "10") - pageSize;

                        if(next >= count) {
                            next = 0;
                        }

                        logger.debug("[contactsOpSizeOffsetGET] Rendering results: " + contacts);
                        res.render('contacts/index-paginated.jade', {
                            locals : {
                                contacts : contacts,
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

// POST a list of contacts (syncService) or a single new contact (syncweb) to the server
exports.contactsPOST = function (req, res) {
    logger.info("POST /" + req.params.service + "/contacts");
    logger.debug("[contactsPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        Contact.findByShareKey(req.currentUser.share_key, function(err, results) {
            if(err) {
                logger.error("[contactsPOST] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[contactsPOST] Going to remove " + results.length + "contacts before adding new ones.");
                contactCreator(0);

                /*
                contactRemover(0);
                function contactRemover(i) {
                    if(i < results.length) {
                        results[i].remove(function(err) {
                            if(err) {
                                logger.error("[contactsPOST] 500 There was an issue removing the #" + i + " contact: " + err);
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                contactRemover(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[contactsPOST] Going to add " + req.body.length + "new contacts.");
                        contactCreator(0);
                    }
                }
                 */

                function contactCreator(i) {
                    if(i < req.body.length) {
                        var contact       = new Contact(req.body[i]);
                        contact.nameclean = contact.name.toLowerCase();
                        contact.share_key = req.currentUser.share_key;
                        contact.save(function(err) {
                            if(err) {
                                logger.error("[contactsPOST] 500 There was an issue saving one of the sent contacts: (" + contact.name + ") " + err);
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                contactCreator(i + 1);
                            }
                        });
                    } else {
                        logger.debug("[contactsPOST] syncService POST was successful.");
                        res.send(HTTP_RESPONSE_SUCCESS_CREATED);
                        require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                    }
                }
            }
        });
    } else {
        if(!req.form.isValid) {
            logger.warn("[contactsPOST] Errors: " + req.form.errors);
            res.render('contacts/new.jade', {
                locals : {
                    contact : new Contact(),
                    number  : req.currentUser.number,
                    isAdmin : req.currentUser.isAdmin,
                    errors  : req.form.errors
                },
                layout : 'with_user_info_layout'
            });
        } else {
            var contact       = new Contact(req.body.contact);
            contact.nameclean = contact.name.toLowerCase();
            contact.share_key = req.currentUser.share_key;
            contact.numbers   = [];
            contact.emails    = [];
            if(contact.nums) {
                for(var numloop = 0; numloop < contact.nums.length; numloop++) {
                    if(contact.numtype[numloop] != '' && contact.nums[numloop] != '') {
                        contact.numbers.push({"type": contact.numtype[numloop], "number": contact.nums[numloop]});
                    }
                }
            }
            if(contact.ems) {
                for(var numloop = 0; numloop < contact.ems.length; numloop++) {
                    if(contact.emstype[numloop] != '' && contact.ems[numloop] != '') {
                        contact.emails.push({"type": contact.emstype[numloop], "email": contact.ems[numloop]});
                    }
                }
            }

            logger.debug("[contactsPOST] Going to add new contact with name: " + contact.name);
            contact.save(function(err) {
                if(err) {
                    logger.error("[contactsPOST] 500 There was an issue saving the contact: (" + contact.name + ") " + err);
                    res.redirect('/500');
                } else {
                    logger.debug("[contactsPOST] syncweb POST was successful.");
                    res.redirect('/syncweb/contacts');
                }
            });
        }
    }
};

// POST a list of contacts (syncService) to the server, smartly merging the two sets of data
exports.contactsOpSmartPOST = function (req, res) {
    logger.info("POST /" + req.params.service + "/contactsSmart");
    logger.debug("[contactsOpSmartPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    smartMerge(0);

    function smartMerge(i) {
        if(i < req.body.length) {
            logger.debug("[contactsOpSmartPOST] Request body: " + JSON.stringify(req.body[i]));
            Contact.findOne({android_id: req.body[i].android_id, share_key: req.currentUser.share_key}, [], function(err, result) {
                if(err) {
                    logger.error("[contactsOpSmartPOST] 500 Database search error: " + err);
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else if(!result) {
                    var contact       = new Contact(req.body[i]);
                    contact.nameclean = contact.name.toLowerCase();
                    contact.share_key = req.currentUser.share_key;
                    contact.save(function(err) {
                        if(err) {
                            logger.error("[contactsOpSmartPOST] 500 There was an issue saving one of the sent contacts: (" + contact.android_id + ") " + err);
                            res.send(HTTP_RESPONSE_SERVER_ERROR);
                        } else {
                            smartMerge(i + 1);
                        }
                    });
                } else {
                    logger.debug("[contactsOpSmartPOST] Result from contact search: " + result);
                    var updated = false;

                    if(result.name != req.body[i].name) {
                        result.name = req.body[i].name;
                        updated     = true;
                    }
                    if(result.nameclean != req.body[i].name.toLowerCase()) {
                        result.nameclean = result.name.toLowerCase();
                        updated          = true;
                    }

                    // Merge numbers
                    var newnum;
                    if (typeof req.body[i].numbers === "undefined") {
                        //do nothing  ... no numbers need uploading for this contact
                    } else {
                        for(var numoutloop = 0; numoutloop < req.body[i].numbers.length; numoutloop++) {
                            newnum = true;
                            for(var numinloop = 0; numinloop < result.numbers.length; numinloop++) {
                                if(req.body[i].numbers[numoutloop].type == result.numbers[numinloop].type) {
                                    if(req.body[i].numbers[numoutloop].number != result.numbers[numinloop].number) {
                                        result.numbers[numinloop].number = req.body[i].numbers[numoutloop].number;
                                        updated = true;
                                    }
                                    newnum = false;
                                    break;
                                }
                            }
                            if(newnum) {
                                result.numbers.push({"type": req.body[i].numbers[numoutloop].type, "number": req.body[i].numbers[numoutloop].number});
                                updated = true;
                            }
                        }
                    }


                    // Merge emails
                    var newem;
                    if (typeof req.body[i].emails === "undefined") {
                        //do nothing  ... no emails need uploading for this contact
                    } else {
                        for(var emoutloop = 0; emoutloop < req.body[i].emails.length; emoutloop++) {
                            newem = true;
                            for(var eminloop = 0; eminloop < result.emails.length; eminloop++) {
                                if(req.body[i].emails[emoutloop].type == result.emails[eminloop].type) {
                                    if(req.body[i].emails[emoutloop].email != result.emails[eminloop].email) {
                                        result.emails[eminloop].email = req.body[i].emails[emoutloop].email;
                                        updated = true;
                                    }
                                    newem = false;
                                    break;
                                }
                            }
                            if(newem) {
                                result.emails.push({"type": req.body[i].emails[emoutloop].type, "email": req.body[i].emails[emoutloop].email});
                                updated = true;
                            }
                        }
                    }

                    if(updated) {
                        result.save(function(err) {
                            if(err) {
                                logger.error("[contactsOpSmartPOST] 500 There was an issue saving one of the sent contacts: (" + result.android_id + ") " + err);
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                smartMerge(i + 1);
                            }
                        });
                    } else {
                        smartMerge(i + 1);
                    }
                }
            });
        } else {
            logger.debug("[contactsOpSmartPOST] syncService POST was successful.");
            res.send(HTTP_RESPONSE_SUCCESS_CREATED);
            require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
        }
    }
};

// POST a paginated list of contacts (syncService) to the server
exports.contactsOpPagedPOST = function (req, res) {
    logger.info("POST /" + req.params.service + "/contacts/op/paged");
    logger.debug("[contactsOpPagedPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        if(req.body.firstpage == true) {
            logger.debug("[contactsOpPagedPOST] First page, removing existing contacts first.");
            Contact.findByShareKey(req.currentUser.share_key, function(err, results) {
                if(err) {
                    logger.error("[contactsOpPagedPOST] 500 Database search error: " + err);
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    logger.debug("[contactsPOST] Going to remove " + results.length + "contacts before adding new ones.");
                    contactRemover(0);

                    function contactRemover(i) {
                        if(i < results.length) {
                            results[i].remove(function(err) {
                                if(err) {
                                    logger.error("[contactsOpPagedPOST] 500 There was an issue removing the #" + i + " contact: " + err);
                                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                                } else {
                                    contactRemover(i + 1);
                                }
                            });
                        } else {
                            logger.debug("[contactsPOST] Going to add " + req.body.data.length + "new contacts.");
                            contactCreator(0);
                        }
                    }
                }
            });
        } else {
            logger.debug("[contactsPOST] Going to add " + req.body.data.length + "new contacts.");
            contactCreator(0);
        }

        function contactCreator(i) {
            if(i < req.body.data.length) {
                var contact       = new Contact(req.body.data[i]);
                contact.nameclean = contact.name.toLowerCase();
                contact.share_key = req.currentUser.share_key;
                contact.save(function(err) {
                    if(err) {
                        logger.error("[contactsOpPagedPOST] 500 There was an issue saving one of the sent contacts: (" + contact.name + ") " + err);
                        res.send(HTTP_RESPONSE_SERVER_ERROR);
                    } else {
                        contactCreator(i + 1);
                    }
                });
            } else {
                logger.debug("[contactsOpPagedPOST] POST was successful.");
                res.send(HTTP_RESPONSE_SUCCESS_CREATED);
                require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
            }
        }
    } else {
        logger.error("[contactsOpPagedPOST] 501 Not implemented for syncweb");
        res.redirect('/500');
    }
};

// DEL all contacts from the server
exports.contactsDEL = function (req, res) {
    logger.info("DELETE /" + req.params.service + "/contacts");
    logger.debug("[contactsDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    Contact.findByShareKey(req.currentUser.share_key, function(err, results) {
        if(err) {
            logger.error("[contactsDEL] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[contactsDEL] Going to remove " + results.length + "contacts.");
            contactRemover(0);

            function contactRemover(i) {
                if(i < results.length) {
                    results[i].remove(function(err) {
                        if(err) {
                            logger.error("[contactsDEL] 500 There was an issue removing the #" + i + " contact: " + err);
                            if(req.params.service == 'syncService') {
                                res.send(HTTP_RESPONSE_SERVER_ERROR);
                            } else {
                                res.redirect('/500');
                            }
                        } else {
                            contactRemover(i + 1);
                        }
                    });
                } else {
                    logger.debug("[contactsDEL] DEL was successful.");
                    if(req.params.service == 'syncService') {
                        res.send(HTTP_RESPONSE_SUCCESS_NO_CONTENT);
                    } else {
                        res.redirect('/syncweb/contacts');
                    }
                }
            }
        }
    });
};


// GET a single contact from the server
exports.contactsIdGET = function (req, res) {
    logger.info("GET /" + req.params.service + "/contacts/" + req.params.contactId);
    logger.debug("[contactsIdGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if (req.params.service == 'syncService') {
        Contact.findOne({_id: req.params.contactId, share_key: req.currentUser.share_key}, ['name', 'numbers', 'emails', 'android_id'], function(err, contact) {
            if(err) {
                logger.error("[contactsIdGET] 500 Database search error: " + err);
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                logger.debug("[contactsIdGET] GET contact: " + contact);
                res.json(contact, HTTP_RESPONSE_SUCCESS_OK);
            }
        });
    } else {
        logger.error("[contactsIdGET] 501 Trying to hit route from syncweb");
        res.redirect('/501');
    }
};

// PUT (Update) a single contact on the server
exports.contactsIdPUT = function (req, res) {
    logger.info("PUT /" + req.params.service + "/contacts/" + req.params.contactId);
    logger.debug("[contactsIdPUT]: " + req.currentUser.id + ", " + req.currentUser.number);

    Contact.findById(req.params.contactId, function(err, contact) {
        if(err) {
            logger.error("[contactsIdPUT] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else if(!contact) {
            logger.error("[contactsIdPUT] The contact does not exist: " + req.params.contactId);
            res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
        } else {
            if(!req.form.isValid && req.params.service != "syncService") {
                logger.warn("[contactsIdPUT] Errors: " + req.form.errors);
                res.render('contacts/edit.jade', {
                    locals : {
                        contact : contact,
                        number  : req.currentUser.number,
                        isAdmin : req.currentUser.isAdmin,
                        errors  : req.form.errors
                    },
                    layout : 'with_user_info_layout'
                });
            } else {
                logger.debug("[contactsIdPUT] Removing the existing contact: " + contact);
                contact.remove(function(err) {
                    if(err) {
                        logger.error("[contactsIdPUT] 400 There was an issue removing the contact: " + err);
                        if(req.params.service == 'syncService') {
                            res.send(HTTP_RESPONSE_CLIENT_ERROR_BAD_REQUEST);
                        } else {
                            res.redirect('/400');
                        }
                    } else {
                        jsonObject           = req.body.contact;
                        jsonObject.share_key = req.currentUser.share_key;
                        jsonObject.id        = req.params.contactId;
                        jsonObject.nameclean = jsonObject.name.toLowerCase();
                        jsonObject.numbers   = [];
                        jsonObject.emails    = [];
                        if(jsonObject.nums) {
                            for(var numloop = 0; numloop < jsonObject.nums.length; numloop++) {
                                if(jsonObject.numtype[numloop] != '' && jsonObject.nums[numloop] != '') {
                                    jsonObject.numbers.push({"type": jsonObject.numtype[numloop], "number": jsonObject.nums[numloop]});
                                }
                            }
                        }
                        if(jsonObject.ems) {
                            for(var numloop = 0; numloop < jsonObject.ems.length; numloop++) {
                                if(jsonObject.emstype[numloop] != '' && jsonObject.ems[numloop] != '') {
                                    jsonObject.emails.push({"type": jsonObject.emstype[numloop], "email": jsonObject.ems[numloop]});
                                }
                            }
                        }
                        var contact          = new Contact(jsonObject);

                        logger.debug("[contactsIdPUT] Now adding the new contact: " + jsonObject.name);
                        contact.save(function(err) {
                            if(err) {
                                logger.error("[contactsIdPUT] 500 There was an issue saving the sent contact: " + jsonObject.name + ", " + err);
                                if(req.params.service == 'syncService') {
                                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                                } else {
                                    res.redirect('/400');
                                }
                            } else {
                                logger.debug("[contactsIdPUT] PUT was successful");
                                if(req.params.service == "syncService") {
                                    res.json(jsonObject, HTTP_RESPONSE_SUCCESS_OK);
                                } else {
                                    res.redirect('/syncweb/contacts');
                                }
                                require('./user_account_routes.js').updateLastBackupDate(req.currentUser.id);
                            }
                        });
                    }
                });
            }
        }
    });
};

// DEL a single contact from the server
exports.contactsIdDEL = function (req, res) {
    logger.info("DELETE /" + req.params.service + "/contacts/" + req.params.contactId);
    logger.debug("[contactsIdDEL]: " + req.currentUser.id + ", " + req.currentUser.number);

    Contact.findOne({_id: req.params.contactId, share_key: req.currentUser.share_key}, function(err, contact) {
        contact.remove(function(err) {
            if(err) {
                logger.error("[contactsIdDEL] 500 Problem removing contact " + req.params.contactId + " from database: " + err);
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SERVER_ERROR);
                } else {
                    res.redirect('/500');
                }
            } else {
                logger.debug("[contactsIdDEL] Contact was deleted successfully.");
                if(req.params.service == 'syncService') {
                    res.send(HTTP_RESPONSE_SUCCESS_RESET_CONTENT);
                } else {
                    res.redirect('/syncweb/contacts');
                }
            }
        });
    });
};

// GET a single contact from the server for editing
exports.contactsIdOpEditGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/" + req.params.contactId + "/op/edit");
    logger.debug("[contactsIdOpEditGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[contactsIdOpEditGET]501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        Contact.findOne({_id: req.params.contactId, share_key: req.currentUser.share_key}, function(err, contact) {
            if(err) {
                logger.error("[contactsIdOpEditGET] 500 Database search error: " + err);
                res.redirect('/500');
            } else {
                logger.debug("[contactsIdOpEditGET] Edit form now rendering for contact: " + contact);
                res.render('contacts/edit.jade', {
                    locals : {
                        contact : contact,
                        number  : req.currentUser.number,
                        isAdmin : req.currentUser.isAdmin,
                        errors  : ''
                    },
                    layout : 'with_user_info_layout'
                });
            }
        });
    }
};


// Download all Contacts in CSV file format
exports.contactsOpDlGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/op/dl");
    logger.debug("[contactsOpDlGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[contactsOpDlGET] 501 Trying to hit contactsOpDlGET route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        Contact.find({share_key: req.currentUser.share_key}, ['name', 'numbers', 'emails'], {sort: [['nameclean', 'ascending']]}, function(err, contacts) {
            if(err) {
                logger.error("[contactsOpDlGET] 500 Database search error: " + err);
                res.redirect('/500');
            } else if(contacts.length == 0) {
                logger.warn("[contactsOpDlGET] No contacts.");
                res.redirect("/syncweb/contacts");
            } else {
                // This check may be redundant, if the directory is created on deployment
                logger.debug("[contactsOpDlGET] Ensuring the outputdir exists and has the correct permissions: " + outputdir);
                fs.stat(outputdir, function(err, stats) {
                    if(err && err.errno == 34) {
                        fs.mkdir(outputdir, function(err) {
                            if(err) {
                                logger.error("[contactsOpDlGET] 500 Creating the outputdir failed: " + err);
                                res.redirect('/500');
                            } else {
                                mkOutput();
                            }
                        });
                    } else if(!err) {
                        mkOutput();
                    } else {
                        logger.error("[contactsOpDlGET] 500 There was an issue with the outputdir: " + err);
                        res.redirect('/500');
                    }
                });

                // Creates the Contact output CSV file
                function mkOutput() {
                    logger.debug("[contactsOpDlGET] Generating the CSV file.");
                    var now  = Date.now();
                    var data = JSON.parse(JSON.stringify(contacts));
                    csv()
                        .from(data)
                        .toPath(outputdir + req.currentUser.id + now + 'Contacts.out', {columns: ['name', 'numbers', 'emails']})
                        .on('end',function(count){
                            var filepath = path.normalize(outputdir + req.currentUser.id + now + 'Contacts.out');
                            logger.debug("[contactsOpDlGET] Opening download window for Contacts.out file at: " + filepath);
                            res.download(filepath, 'Contacts.out', function(err) {
                                if(err) {
                                    logger.error("[contactsOpDlGET] 500 Problem with downloading Contact CSV file: " + err);
                                    res.redirect('/500');
                                } else {
                                    logger.debug("[contactsOpDlGET] Deleting the temp Contacts.out CSV file");
                                    fs.unlink(filepath, function(err) {
                                        if(err) {
                                            logger.error("[contactsOpDlGET] 500 Problem deleting temporary Contact CSV file: " + err);
                                            res.redirect('/500');
                                        } else {
                                            logger.debug("[contactsOpDlGET] Contacts.out CSV file operation was successful.");
                                        }
                                    });
                                }
                            });
                        })
                        .on('error',function(error) {
                            logger.error("[contactsOpDlGET] 500 Contact CSV creation failure: " + err);
                            res.redirect('/500');
                        });
                }
            }
        });
    }
};


// Display the add contact form
exports.contactsOpNewGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/op/new");
    logger.debug("[contactsOpNewGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == "syncService") {
        logger.error("[contactsOpNewGET] 501 Trying to hit route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        logger.debug("[contactsOpNewGET] Now rendering form for new contact.");
        res.render('contacts/new.jade', {
            locals : {
                contact : new Contact(),
                number  : req.currentUser.number,
                isAdmin : req.currentUser.isAdmin,
                errors  : ''
            },
            layout : 'with_user_info_layout'
        });
    }
};

// Allow the user to authenticate their GMail account
exports.contactsOpGmailOAuthGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/op/gmailOAuth");
    logger.debug("[contactsOpGmailOAuthGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        logger.error("[contactsOpGmailOAuthGET] 501 Trying to hit the route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        var client_id     = "898501483873.apps.googleusercontent.com";
        var client_secret = "fEVR1oZb8HaIAqHI5pUkeTI5";
        var scope         = "https://www.google.com/m8/feeds";
        var address       = appaddress + '/' + req.params.service  + '/contacts/op/gmailImport';

        oa = new oauth.OAuth2(client_id, client_secret, "https://accounts.google.com/o", "/oauth2/auth", "/oauth2/token");
        logger.debug("[contactsOpGmailOAuthGET] Redirecting user to authentication page.");
        res.redirect(oa.getAuthorizeUrl(
            {
                scope         : scope,
                response_type : 'code',
                redirect_uri  : address
            }
        ));
    }
};

// Import all contacts from the authenticated GMail account
// TODO: Needs to be updated to match new contacts schema
exports.contactsOpGmailImportGET = function(req, res) {
    logger.info("GET /" + req.params.service + "/contacts/op/gmailImport");
    logger.debug("[contactsOpGmailImportGET]: " + req.currentUser.id + ", " + req.currentUser.number);

    if(req.params.service == 'syncService') {
        logger.error("[contactsOpGmailImportGET] 501 Trying to hit the route from syncService");
        res.send(HTTP_RESPONSE_NOT_IMPLEMENTED);
    } else {
        var address = appaddress + '/' + req.params.service  + '/contacts/op/gmailImport';

        logger.debug("[contactsOpGmailImportGET] Getting access token.");
        oa.getOAuthAccessToken(req.query.code, {grant_type:'authorization_code', redirect_uri:address}, function(err, access_token, refresh_token) {
            if(err) {
                logger.error("[contactsOpGmailImportGET] 500 Error getting the OAuth Access token for GMail contact importing: " + err);
                res.redirect('/500');
            } else {
                request(
                    {
                        method  : 'GET',
                        uri     : 'https://www.google.com/m8/feeds/contacts/default/full?alt=json&max-results=' + MAX_NUM_CONTACTS_FOR_GMAIL,
                        headers :
                            {
                                "GData-Version" : "3.0",
                                "Authorization" : "Bearer " + access_token
                            }
                    }
                , function(error, response, body) {
                    if(error || response.statusCode != 200) {
                        logger.error('[contactsOpGmailImportGET] error: '+ response.statusCode);
                        logger.error('[contactsOpGmailImportGET] body: ' + body);
                        res.redirect('/400');
                    } else {
                        logger.debug("[contactsOpGmailImportGET] Starting contacts import.");

                        var googleContacts = [];
                        var gmailAPIResObj = JSON.parse(body);
                        var contactEntries = gmailAPIResObj.feed.entry;

                        contactGetter(0);

                        function contactGetter(i) {
                            if(i < contactEntries.length) {
                                if(contactEntries[i].gd$name) {
                                    var baseName = contactEntries[i].gd$name.gd$fullName.$t;
                                    var email    = ""
                                    var phoneNum = "";

                                    if(contactEntries[i].gd$email) {
                                        email = contactEntries[i].gd$email[0].address;
                                    }

                                    if(!contactEntries[i].gd$phoneNumber) {         //no phone numbers listed
                                        var googleContact = {
                                            "name"   : baseName,
                                            "number" : phoneNum,
                                            "email"  : email
                                        };

                                        logger.debug("[contactsOpGmailImportGET] Pushing contact #1: " + baseName);
                                        googleContacts.push(googleContact);

                                        contactGetter(i + 1);
                                    } else {
                                        multiGetter(0);

                                        function multiGetter(j) {
                                            if(J < contactEntries[i].gd$phoneNumber.length) {
                                                var name = baseName + " (" + contactEntries[i].gd$phoneNumber[j].rel.split("#")[1] + ")";

                                                if(contactEntries[i].gd$phoneNumber) {
                                                    phoneNum = contactEntries[i].gd$phoneNumber[j].$t;
                                                }

                                                var googleContact = {
                                                    "name"   : name,
                                                    "number" : phoneNum,
                                                    "email"  : email
                                                };

                                                logger.debug("[contactsOpGmailImportGET] Pushing contact #2: " + name);
                                                googleContacts.push(googleContact);

                                                multiGetter(j + 1);
                                            } else {
                                                contactGetter(i + 1);
                                            }
                                        }
                                    }
                                } else {
                                    contactGetter(i + 1);
                                }
                            } else {
                                logger.debug("[contactsOpGmailImportGET] Saving contacts to db.");
                                contactAdder(0);
                            }
                        }

                        function contactAdder(k) {
                            if(k < googleContacts.length) {
                                var contact       = new Contact(googleContacts[k]);
                                contact.nameclean = contact.name.toLowerCase();
                                contact.share_key = req.currentUser.share_key;
                                contact.save(function(err) {
                                    if(err) {
                                        logger.error("[contactsOpGmailImportGET] 400 There was an issue saving one of the sent contacts: " + contact.name + ", " + err);
                                        res.redirect('/400');
                                    } else {
                                        logger.error("[contactsOpGmailImportGET] Contact saved successfully: " + contact.name + ", " + err);
                                        contactAdder(k + 1);
                                    }
                                });
                            } else {
                                res.redirect('/syncweb/contacts');
                            }
                        }
                    }
                });
            }
        });
    }
};


// Search all Contacts for the given search term
exports.contactsOpSearchPOST = function(req, res) {
    logger.info("POST /" + req.params.service + "/contacts/op/search");
    logger.debug("[contactsOpSearchPOST]: " + req.currentUser.id + ", " + req.currentUser.number);

    var searchTerm = req.body.searchTerm.replace(/(["\s'$`\\])/g,'\\$1');
    var expression = new RegExp(searchTerm, "i");

    logger.debug("[contactsOpSearchPOST] Executing search for: " + searchTerm);
    Contact.find({$and: [{share_key: req.currentUser.share_key}, {$or: [{name : expression}, {numbers : expression}, {emails : expression}]}]}, ['name', 'numbers', 'emails'], {sort: [['nameclean', 'ascending']]}, function(err, contacts) {
        if(err) {
            logger.error("[contactsOpSearchPOST] 500 Database search error: " + err);
            if(req.params.service == 'syncService') {
                res.send(HTTP_RESPONSE_SERVER_ERROR);
            } else {
                res.redirect('/500');
            }
        } else {
            logger.debug("[contactsOpSearchPOST] Search successful. Passing results accordingly: " + results);
            if(req.params.service == 'syncService') {
                res.json(contacts, HTTP_RESPONSE_SUCCESS_OK);
            } else {
                res.render('contacts/index.jade', {
                    locals : {
                        contacts : contacts,
                        number   : req.currentUser.number,
                        isAdmin  : req.currentUser.isAdmin
                    },
                    layout : 'with_user_info_layout'
                });
            }
        }
    });
};



// Set a bunch of test data for the given share_key
exports.populate = function (req, res) {
    logger.info("GET /populatecontacts" + req.params.shareKey);
    logger.debug("[populate CONTACTS]");

    var shareKey = req.params.shareKey;
    var amount   = 10;

    contactCreator(0);

    function contactCreator(i) {
        if(i < amount) {
            var contact       = new Contact();
            contact.name      = "Name" + i + "name";
            contact.nameclean = contact.name.toLowerCase();
            contact.numbers   =  [ {"type": "work", "number": "202-555-1111"}, {"type": "cell", "number": "800-555-1212"} ];
            contact.emails    =  [ {"type": "work", "email": "georgie@peek.ly"}, {"type": "personal", "email": "georgethefirst@hotmail.com"} ];
            contact.share_key = shareKey;

            contact.save(function(err) {
                if(err) {
                    logger.error("[populate CONTACTS] Saving contact error: " + contact.name);
                    res.redirect('/500');
                } else {
                    contactCreator(i + 1);
                }
            });
        } else {
            res.redirect('/');
        }
    }
};
