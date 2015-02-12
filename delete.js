'use strict';
var nameMatcher = require("./lib/nameMatcher.js");
nameMatcher.whenReady.then(function(value) {
    nameMatcher.clearNames();
});
