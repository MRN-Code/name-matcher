'use strict';

/**
 * nameMatcher object to expose methods for adding names and matching against them.
 * @module nameMatcher.
 */


// Private variables and external modules
const rsvp = require('rsvp');
// Set up rsvp global error handler to handle uncaught errors thrown within a promise-chain
rsvp.on('error', (err) => {
  console.log('uncaught rejection of promise', err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
});
const Promise = rsvp.Promise;
const redis = require('redis');
const natural = require('natural');
const _ = require('underscore');

const nameMatcher = {};
let redisClient;
let firstNames;
let lastNames;
let firstNamesDev;
let lastNamesDev;

// static private helper functions
/**
 * Helper function to wrap standard callback-based async functions in a promise
 * @param {function} fn - The function to be called
 * @param  {array} args - array of arguments to be passed to the function
 * @param  {object=} _this - object to use as `this` when calling the function defaults to null
 * @return {Promise} promise to be resolved or rejected when the async fn is complete
 */
const promisify = function (fn, args, _this) {
  _this = _this || null;
  return new Promise((resolve, reject) => {
    const promiseCallback = function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };
    if (_.isArguments(args)) {
      args = _.toArray(args);
    }
    args.push(promiseCallback);
    return fn.apply(_this, args);
  });
};


/**
 * Function to retrieve the metaphone for a name.
 * Will retrieve the metaphone from the local collection of names if it exists,
 * or generate and store it if it does not.
 * @param {string} name - the name to generate a metaphone for
 * @param {object} localCollection - a collection of name-indexed metaphones (optional)
 * @return {array} an array of the generated metaphones, eg ["JKP", "AKP"].
 */
const getMetaphone = function (name, localCollection) {
  localCollection = localCollection || {};
  const dm = natural.DoubleMetaphone;
  if (localCollection[name]) {
    return localCollection[name];
  }
  return dm.process(name);
};


/**
 * simple function to clear the database of names
 * should only be used from the cli in a development environment
 */
nameMatcher.clearNames = function () {
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
const compareNames = function (name1, name2, localCollection) {
  const jaro = natural.JaroWinklerDistance(name1, name2);
  const mp1 = getMetaphone(name1, localCollection);
  const mp2 = getMetaphone(name2, localCollection);
  const match1 = mp1[0] === mp2[0];
  const match2 = mp1[1] === mp2[1];
    // Match the inputs
  if (match1 === true &&
        match2 === true &&
        jaro >= 0.6) {
        // Both metaphones match exactly, and strings have distance of 0.6
    return true;
  } else if ((match1 || match2) &&
        jaro >= 0.7) {
        // One of the two metaphones match exactly, and strings have distance of 0.7
    return true;
  } else if (jaro >= 0.82) {
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
const parseMetaphones = function (inputCollection) {
  _.each(inputCollection, (metaphone, name) => {
    inputCollection[name] = metaphone.split(':');
    return inputCollection;
  }, {});
  return inputCollection;
};


/**
 * refresh the firstNames and lastNames by reading from the persistent source (redis db)
 * @return {Promise} a promise to be fulfilled with bool=true when refresh is complete
 */
const refresh = function () {
  console.log('nameMatcher refreshing local names');
  const firstNamePromise = promisify(redisClient.hgetall, ['firstNames'], redisClient);
  const lastNamePromise = promisify(redisClient.hgetall, ['lastNames'], redisClient);
  const firstNamePromiseDev = promisify(redisClient.hgetall, ['firstNamesDev'], redisClient);
  const lastNamePromiseDev = promisify(redisClient.hgetall, ['lastNamesDev'], redisClient);
  const allNames = [
    lastNamePromise,
    firstNamePromise,
    lastNamePromiseDev,
    firstNamePromiseDev,
  ];
  return Promise
        .all(allNames)
        .then((names) => {
            // names = [lastNames, firstNames]
            // firstNames = {bob: 'MP1:MP2', rachel: 'MP3:MP4'}
            // assign names to local private variables
          lastNames = parseMetaphones(names[0] || {});
          firstNames = parseMetaphones(names[1] || {});
          lastNamesDev = parseMetaphones(names[2] || {});
          firstNamesDev = parseMetaphones(names[3] || {});

          console.log('nameMatcher refreshing names complete');
          return true;
        }).catch((err) => {
          console.error('Encountered error refreshing local names');
          console.error(err);
          throw err;
        });
};


/**
 * Initialization function. Sets redisClient, and creates whenReady promise that will resolve when the redis connection is ready and data has been populated from the redis DB;
 * @return {object} nameMatcher
 */
const init = function () {
  console.log('initializing nameMatcher');
  nameMatcher.whenReady = new Promise((resolve, reject) => {
    redisClient = redis.createClient();
    redisClient.on('ready', () => {
      console.log('nameMatcher redis connection established');
      return refresh().then(() => {
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
nameMatcher.addName = function (first, last) {
  if (process.env.NODE_ENV === 'production') {
    var firstMP = getMetaphone(first, firstNames);
    var lastMP = getMetaphone(last, lastNames);
        // Store the current values for the first and last name in case things go badly
    var backupFirstName = firstNames[first];
    var backupLastName = lastNames[last];
        // Set names in local collections
    firstNames[first] = firstMP;
    lastNames[last] = lastMP;
  } else if (process.env.NODE_ENV === 'development') {
    var firstMP = getMetaphone(first, firstNamesDev);
    var lastMP = getMetaphone(last, lastNamesDev);
        // Store the current values for the first and last name in case things go badly
    var backupFirstName = firstNamesDev[first];
    var backupLastName = lastNamesDev[last];
        // Set names in local collections
    firstNamesDev[first] = firstMP;
    lastNamesDev[last] = lastMP;
  }

  const firstMPString = `${firstMP[0]}:${firstMP[1]}`;
  const lastMPString = `${lastMP[0]}:${lastMP[1]}`;
    // Set names in persistent DB
  const firstNamePromise = promisify(
            redisClient.hset,
            [((process.env.NODE_ENV === 'production') ? 'firstNames' : 'firstNamesDev'), first, firstMPString],
            redisClient)
            .catch((err) => {
              console.log('Error adding first name. Reverting value');
                // Restore localCollection to original value
              firstNames[first] = backupFirstName;
              throw err;
            });
  const lastNamePromise = promisify(
            redisClient.hset,
            [((process.env.NODE_ENV === 'production') ? 'lastNames' : 'lastNamesDev'), last, lastMPString],
            redisClient)
            .catch((err) => {
              console.log('Error adding last name. Reverting value');
                // Restore localCollection to original value
              lastNames[last] = backupLastName;
              throw err;
            });

  return Promise.all([lastNamePromise, firstNamePromise])
        .then((nameResults) => {
          console.log('nameMatcher successfully added name');
          return true;
        })
        .catch((err) => {
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
nameMatcher.matchName = function (name) {
  const matches = { original: name, first: [], last: [] };
  if (process.env.NODE_ENV === 'production') {
    matches.first = _.keys(firstNames)
            .filter(localName => compareNames(name.first, localName, firstNames));
    matches.last = _.keys(lastNames)
            .filter(localName => compareNames(name.last, localName, lastNames));
  } else if (process.env.NODE_ENV === 'development') {
    matches.first = _.keys(firstNamesDev)
            .filter(localName => compareNames(name.first, localName, firstNamesDev));
    matches.last = _.keys(lastNamesDev)
            .filter(localName => compareNames(name.last, localName, lastNamesDev));
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
nameMatcher.matchNames = function (nameList) {
  const _this = this;
  return nameList.map(name => _this.matchName(name));
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
