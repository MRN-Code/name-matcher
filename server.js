'use strict';
var nameMatcher = require("./lib/nameMatcher.js");
var hapi = require('hapi');
var fs = require('fs');
nameMatcher.whenReady.then(function(value) {
    var server = new hapi.Server();
    server.connection({
        tls: {
            key: fs.readFileSync('./cert/self.key'),
            cert: fs.readFileSync('./cert/self.crt')
        },
        port: 3000
    });
    // production match
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
          
            reply(nameMatcher.matchNames(nameObjects, "prod"));
        }
    });
    // production add 
    server.route({
        method: 'POST',
        path: '/',
        handler: function (request, reply) {
            if (request.payload.first !== undefined  
                && request.payload.last !== undefined ){
	        var firstList = request.payload.first.split(',');
                var lastList = request.payload.last.split(',');
                if (firstList.length !== lastList.length) {
                    reply('failure: unpaired first/last');
                }
                for (var i=0; i < firstList.length; i++) {
                    if (firstList[i] !== '' || lastList[i] !== '') {
                    nameMatcher.addName(firstList[i], lastList[i], "prod");
                    } else {
                        reply('failure: no names');
                    }
                }
                reply('success');
            } else {
                reply('failure: no names');
            }
        }
    });

    // dev match
    server.route({
        method: 'GET',
        path: '/dev/{names}',
        handler: function (request, reply) {
            var nameList = request.params.names.split(":");
            var nameObjects  = nameList.map(function createNameObjects(current) {
                var nameObj = {};
                current = current.split(",");
                nameObj.first = current[0];
                nameObj.last = current[1];
                
                return nameObj;
            });
          
            reply(nameMatcher.matchNames(nameObjects, "prod"));
        }
    });
    // dev add 
    server.route({
        method: 'POST',
        path: '/dev',
        handler: function (request, reply) {
            console.log("POST: ");
            console.log(request.payload);
            nameMatcher.addName(request.payload.first, request.payload.last, "prod");
            reply('success');
        }
    });
    
    server.start(function () {
        console.log('Server running at:', server.info.uri);
    });
});
