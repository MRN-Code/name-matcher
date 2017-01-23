'use strict';

const nameMatcher = require('./lib/nameMatcher.js');
const hapi = require('hapi');
const boom = require('boom');
const config = require('config').get('server');

if (config.environment === 'production') {
  process.env.NODE_ENV = 'production';
} else {
  process.env.NODE_ENV = 'development';
}
nameMatcher.whenReady.then((value) => {
  const options = {};
  if (config.ssl.enabled) {
    options.tls = require('./lib/sslCredentials.js');
  }
  options.port = 3500;
  const server = new hapi.Server();
  server.connection(options);

    // match names
  server.route({
    method: 'GET',
    path: '/{names}',
    handler(request, reply) {
      const nameList = request.params.names.split(':');
      const nameObjects = nameList.map((current) => {
        const nameObj = {};
        current = current.split(',');
        nameObj.first = current[0];
        nameObj.last = current[1];

        return nameObj;
      });

      reply(nameMatcher.matchNames(nameObjects));
    },
  });
    // add names
  server.route({
    method: 'POST',
    path: '/',
    handler(request, reply) {
      if (request.payload.first !== undefined
                && request.payload.last !== undefined) {
	        const firstList = request.payload.first.split(',');
        const lastList = request.payload.last.split(',');
        if (firstList.length !== lastList.length) {
          reply(boom.badRequest('failure: unpaired first/last'));
        }
        for (let i = 0; i < firstList.length; i++) {
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
    },
  });
  server.start(() => {
    console.log('Server running at:', server.info.uri);
  });
});
