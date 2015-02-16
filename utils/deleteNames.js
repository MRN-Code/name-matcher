'use strict';
/* deleteNames is a command line only utility
 * to clear the database of names
 */
var nameMatcher = require("./lib/nameMatcher.js");
nameMatcher.whenReady.then(function(value) {
    nameMatcher.clearNames();
});
