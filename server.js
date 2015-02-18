'use strict';
var config = require('config').get('server');
if (config.environment === "production") {
    process.env.NODE_ENV = 'production';
} else {
    process.env.NODE_ENV = 'development';
}
var nameMatcher = require("./lib/nameMatcher.js");
var hapi = require('hapi');
var fs = require('fs');
var boom = require('boom');
nameMatcher.whenReady.then(function(value) {
    var options = {};
    if (config.ssl.enabled) {
        options.tls = require('./lib/sslCredentials.js');
    }
    if (process.env.NODE_ENV === "production") {
        options.port = 3000;
    } else {
        options.port = 2999;
    }
    var server = new hapi.Server();
    server.connection(options);

    // match names
    server.route({
        method: 'GET',
        path: '/{names}',
        handler: function (request, reply) {
            var nameList = request.params.names.split(":");
            var nameObjects  = nameList.map(function createNameObjects(current) {
                var nameObj = {};
                current = current.split(",");
                nameObj.first = current[0];
                nameObj.last = current[1];
                
                return nameObj;
            });
          
            reply(nameMatcher.matchNames(nameObjects));
        }
    });
    // add names
    server.route({
        method: 'POST',
        path: '/',
        handler: function (request, reply) {
            if (request.payload.first !== undefined  
                && request.payload.last !== undefined ){
	        var firstList = request.payload.first.split(',');
                var lastList = request.payload.last.split(',');
                if (firstList.length !== lastList.length) {
                    reply(boom.badRequest('failure: unpaired first/last'));
                }
                for (var i=0; i < firstList.length; i++) {
                    if (firstList[i] !== '' || lastList[i] !== '') {
                       nameMatcher.addName(firstList[i], lastList[i]);
                    } else {
                        reply(boom.badRequest('failure: empty names in list'));
                    }
                }
                reply('success');
            } else {
                reply(boom.badRequest('failure: no names'));
            }
        }
    });
    server.start(function () {
        console.log('Server running at:', server.info.uri);
    });
});
