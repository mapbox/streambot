var url = require('url');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

module.exports = streambot;
module.exports.env = require('./lib/env');
module.exports.connector = require('./lib/connector');

function streambot(service, envUrl) {
  return function streambot(event, context) {
    var callback = context.done.bind(context);

    if (!envUrl) return service(event, callback);

    envUrl = url.parse(envUrl);

    s3.getObject({
      Bucket: envUrl.hostname,
      Key: envUrl.pathname.slice(1)
    }, function(err, data) {
      if (err) return callback(err, 'Failed to load environment from S3');

      var env = JSON.parse(data.Body);
      Object.keys(env).forEach(function(key) {
        process.env[key] = env[key];
      });

      service(event, callback);
    });
  };
}
