'use strict';
/**
 * nameMatcher module
 * exports nameMatcher object to expose methods for adding names and matching against them.
 */


// Private variables and external modules
var rsvp = require('rsvp');
// Set up rsvp global error handler to handle uncaught errors thrown within a promise-chain
rsvp.on('error', function catchGlobalRSVPError(err) {
    console.log('uncaught rejection of promise', err);
    if (err instanceof Error && err.stack) {
        console.error(err.stack);
    }
});
var Promise = rsvp.Promise;
var redis = require('redis');
var natural = require('natural');
var _ = require('underscore');

var nameMatcher = {};
var redisClient;
// firstNames = e.g. {bob: bobMetaphoneHash, rachel: rachelMetaphoneHash}
var firstNames;
var lastNames;
var firstNamesDev;
var lastNamesDev;


//static private helper functions
/**
 * Helper function to wrap standard callback-based async functions in a promise
 * @param fn {function} The function to be called
 * @param args {array} array of arguments to be passed to the function
 * @param _this {object} (optional) object to use as `this` when calling the function defaults to null
 * @return {Promise} promise to be resolved or rejected when the async fn is complete
 */
var promisify = function (fn, args, _this) {
    _this = _this || null;
    return new Promise(function promisifyWrapper(resolve, reject) {
        var promiseCallback = function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
            return;
        };
        args.push(promiseCallback);
        return fn.apply(_this, args);
    });
};


/**
 * Helper function to generate the metaphone for a name.
 * Will retrieve the metaphone from the local collection of names if it exists.
 * @param name {string} the name to generate a metaphone for
 * @param localCollection {object} a collection of name-indexed metaphones (optional)
 * @return {array} an array of the generated metaphones.
 */
var getMetaphone = function (name, localCollection) {
    localCollection = localCollection || {};
    var dm = natural.DoubleMetaphone;
    if (localCollection[name]) {
        return localCollection[name];
    }
    return dm.process(name);
};


/**
 * simple function to clear the database of names
 */
nameMatcher.clearNames = function() {
    redisClient.del('firstNames', console.log('deleted first'));
    redisClient.del('lastNames', console.log('deleted last'));
};


/**
 * Compare two names based on phonetics and string similarity
 * @param name1 {string} the name to be used in the comparison
 * @param name2 {string} the name to be compared against
 * @param localCollection {object} a collection of name-indexed metaphones (e.g firstNames or lastNames)
 * @return {boolean} true if names are considered a match. false otherwise
 */
var compareNames = function (name1, name2, localCollection) {
    var jaro = natural.JaroWinklerDistance(name1, name2);
    var mp1 = getMetaphone(name1, localCollection);
    var mp2 = getMetaphone(name2, localCollection);
    var match1 = mp1[0] === mp2[0] ? true : false;
    var match2 = mp1[1] === mp2[1] ? true : false;
    // Match the inputs
    if (match1 === true &&
        match2 === true &&
        jaro >= 0.6) {
        // Both metaphones match exactly, and strings have distance of 0.6
        return true;
    } else if ((match1 + match2) &&
        jaro >= 0.7) {
        // One of the two metaphones match exactly, and strings have distance of 0.7
        return true;
    } else if (jaro >= 0.9) {
        // The strings are highly similar
        return true;
    }
    // No match
    return false;
};


/**
 * parse all metaphones in a collection into array format
 * @param inputCollection {object} a collection of name-indexed metaphones where the metaphones are colon-delimited (e.g. TYL:TYL)
 * @return {object} the localCollection with the delimited metaphones replaced with arrays
 */
var parseMetaphones = function (inputCollection) {
    return _.each(inputCollection, function parseMetaphone(metaphone, name) {
        inputCollection[name] = metaphone.split(':');
        return inputCollection;
    }, {});
};


/**
 * refresh the firstNames and lastNames by reading from the persistent source (redis db)
 * @return {Promise} a promise to be fulfilled with bool=true when refresh is complete
 */
var refresh = function () {
    console.log('nameMatcher refreshing local names');
    var firstNamePromise = promisify(redisClient.hgetall, ['firstNames'], redisClient);
    var lastNamePromise = promisify(redisClient.hgetall, ['lastNames'], redisClient);
    var firstNamePromiseDev = promisify(redisClient.hgetall, ['firstNamesDev'], redisClient);
    var lastNamePromiseDev = promisify(redisClient.hgetall, ['lastNamesDev'], redisClient);
    return Promise.all(
        [
        lastNamePromise,
        firstNamePromise,
        lastNamePromiseDev,
        firstNamePromiseDev
        ])
        .then(function storeNamesLocally(names) {
            // names = [lastNames, firstNames]
            // firstNames = {bob: 'MP1:MP2', rachel: 'MP3:MP4'}
            // assign names to local private variables
            lastNames = parseMetaphones(names[0] || {});
            firstNames = parseMetaphones(names[1] || {});
            lastNamesDev = parseMetaphones(names[3] || {});
            firstNamesDev = parseMetaphones(names[4] || {});

            console.log('nameMatcher refreshing names complete');
            return true;
        }).catch(function catchRefreshError(err) {
            console.error('Encountered error refreshing local names');
            console.error(err);
            throw err;
        });
};


/**
 * Initialization function. Sets redisClient, and creates whenReady promise that will resolve when the redis connection is ready and data has been populated from the redis DB;
 * @return {object} nameMatcher
 */
var init = function () {
    console.log('initializing nameMatcher');
    nameMatcher.whenReady = new Promise(function promisifyWhenReady(resolve, reject) {
        redisClient = redis.createClient();
        redisClient.on('ready', function refreshWhenConnectionReady() {
            console.log('nameMatcher redis connection established');
            return refresh().then(function resolveWhenReadyPromise() {
                console.log('nameMatcher initialization complete');
                resolve(nameMatcher);
            });
        });
    });
    return nameMatcher;
};


// public methods

/**
 * Add a new name to the list of names (adds to in-memory list and to persistent storage)
 * @param first {string} the first name
 * @param last {string} the last name
 * @return {Promise} a promise to be fulfilled with a boolean if both names were added (or are already existing)
 */
nameMatcher.addName = function (first, last, environment) {
    if (environment === "prod") {
        var firstMP = getMetaphone(first, firstNamesDev);
        var lastMP = getMetaphone(last, lastNamesDev);
        // Store the current values for the first and last name in case things go badly
        var backupFirstName = firstNames[first];
        var backupLastName = lastNames[last];
        // Set names in local collections
        firstNames[first] = firstMP;
        lastNames[last] = lastMP;
    } else if (environment === "dev") {
        var firstMP = getMetaphone(first, firtNamesDev);
        var lastMP = getMetaphone(last, lastNamesDev);
        // Store the current values for the first and last name in case things go badly
        var backupFirstName = firstNamesDev[first];
        var backupLastName = lastNamesDev[last];
        // Set names in local collections
        firstNamesDev[first] = firstMP;
        lastNamesDev[last] = lastMP;
    }

    var firstMPString = firstMP[0] + ':' + firstMP[1];
    var lastMPString = lastMP[0] + ':' + lastMP[1];
    // Set names in persistent DB
    var firstNamePromise = promisify(
            redisClient.hset,
            [ ((environment === "prod") ? 'firstNames' : 'firstNamesDev'), first, firstMPString ],
            redisClient)
            .catch(function catchAddFirstNameError(err) {
                console.log('Error adding first name. Reverting value');
                // Restore localCollection to original value
                firstNames[first] = backupFirstName;
                throw (err);
            });
    var lastNamePromise = promisify(
            redisClient.hset,
            [ ((environment === "prod") ? 'lastNames' : 'lastNamesDev'), last, lastMPString ],
            redisClient)
            .catch(function catchAddLastNameError(err) {
                console.log('Error adding last name. Reverting value');
                // Restore localCollection to original value
                lastNames[last] = backupLastName;
                throw (err);
            });
    return Promise.all([lastNamePromise, firstNamePromise])
        .then(function logAddNameSuccess(nameResults) {
            console.log('nameMatcher successfully added name');
            return true;
        })
        .catch(function catchAddNameError(err) {
            console.error('Encountered error refreshing local names');
            console.error(err);
            throw err;
        });
};


/**
 * match the input name against names in firstNames and lastNames
 * @param name {object} an object with a 'first' and 'last' property
 * @return {object} an object with the following properties:
 * original: the original name object provided as input
 * first: an array of first names that match original.first
 * last: an array of last names that match original.last
 */
nameMatcher.matchName = function (name, environment) {
    var matches = { original: name, first: [], last: [] };
    if (environment === "prod") {
        matches.first = _.keys(firstNames)
            .filter(function compareFirstNames(localName) {
                return compareNames(name.first, localName, firstNames);
        });
        matches.last = _.keys(lastNames)
            .filter(function compareLastNames(localName) {
                return compareNames(name.last, localName, lastNames);
        });
    } else if (environment === "dev") {
        matches.first = _.keys(firstNamesDev)
            .filter(function compareFirstNames(localName) {
                return compareNames(name.first, localName, firstNamesDev);
        });
        matches.last = _.keys(lastNamesDev)
            .filter(function compareLastNames(localName) {
                return compareNames(name.last, localName, lastNamesDev);
        });
    }
    return matches;
};


/**
 * calls matchName for each name in nameList
 * @param nameList {array} an array of objects with a 'first' and 'last' property
 * @return {array} an array of objects with the following properties:
 * original: the original name object provided as input
 * first: an array of first names that match original.first
 * last: an array of last names that match original.last
 */
nameMatcher.matchNames = function (nameList, environment) {
    var tempMatcher = this;
    return nameList.map(function(name) { 
        return tempMatcher.matchName(name, environment); 
    });
};


/**
 * close the redis client connection
 */
nameMatcher.close = function () {
    redisClient.quit();
};

// Call the init function
init();
// export nameMatcher object.
module.exports = nameMatcher;
