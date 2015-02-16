var os = require('os');
var fs = require('fs');
var config = require('config').get('server');
var hostnameSSL = os.hostname().split(".");
var certPath, keyPath, chainPath;
var sslOptions = {};

// switch based on whether to use self-signed certs
if (os.hostname().match(/mrn.org/)) {
    // use wildcard certs
    certPath = './cert/' + config.ssl.crt;
    keyPath = './cert/' + config.ssl.key;
    chainPath = './cert/' + config.ssl.bundle;
} else {
    // dev environment: use self-signed certs
    certPath = '/etc/pki/tls/certs/localhost.crt';
    keyPath = '/etc/pki/tls/private/localhost.key';
    chainPath = null;
}

try {
    if (chainPath) {
        // generate array of chain certs
        var chainedCerts = fs.readFileSync(chainPath, 'utf8');
        var delimiter = chainedCerts.match(/-*END CERTIFICATE-*/)[0];
        sslOptions.ca = chainedCerts.split(delimiter)
            .map(function reConcatDelim(certString){
                    return certString + delimiter;
                 });
    }
    sslOptions.key = fs.readFileSync(keyPath, 'utf8');
    sslOptions.cert = fs.readFileSync(certPath, 'utf8');
}
catch (err) {
    console.dir(err);
    throw new Error ('Error parsing chain certificate file');
}

module.exports = sslOptions;
