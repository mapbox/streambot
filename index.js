var AWS = require('aws-sdk');
var fastlog = require('fastlog');
var dotenv = require('dotenv');

module.exports = streambot;
module.exports.deploy = require('./lib/deploy');

function streambot(service) {
  dotenv.load();

  var log = module.exports.log = new Logger(fastlog(process.env.StackName, 'debug'));

  return function streambot(event, context) {
    function callback(err) {
      if (err) log.error(err);

      var cloudwatch = new AWS.CloudWatch({
        region: process.env.StackRegion
      });
      var s3 = new AWS.S3();

      var params = {
        Namespace: 'streambot',
        MetricData: [
          {
            MetricName: process.env.MetricName,
            Value: 1,
            Dimensions: [{ Name: 'Status' }]
          }
        ]
      };

      params.MetricData[0].Dimensions[0].Value = err ? 'Error' : 'Success';

      var eventIds = event.Records.map(function(record) {
        return record.eventID;
      });

      function finished() {
        context.done(err, 'Processed events: ' + eventIds.join(' '));
      }

      cloudwatch.putMetricData(params, function(error) {
        if (error) log.error(error);

        var bucket = process.env.LogBucket;
        var prefix = process.env.LogPrefix;

        if (bucket && log.logs().length) {
          var filename = [
            process.env.StackName,
            eventIds[0].split(':')[0],
            eventIds.slice(-1)[0].split(':')[1]
          ].join('/');
          if (prefix) filename = [prefix, filename].join('/');

          return s3.putObject({
            Bucket: bucket,
            Key: filename,
            Body: new Buffer(log.logs())
          }, function() {
            finished();
          });
        }

        finished();
      });
    }

    var records = event.Records
      .filter(function(record) {
        return record.eventName === 'aws:kinesis:record';
      }).map(function(record) {
        record.kinesis.data = new Buffer(record.kinesis.data, 'base64').toString();
        return record.kinesis;
      });

    service(records, callback);
  };
}

function Logger(fastlog) {
  var logs = [];

  var logger = {
    debug: function() {
      logs.push(fastlog.debug.apply(logger, arguments));
    },

    info: function() {
      logs.push(fastlog.info.apply(logger, arguments));
    },

    warn: function() {
      logs.push(fastlog.warn.apply(logger, arguments));
    },

    error: function() {
      logs.push(fastlog.error.apply(logger, arguments));
    },

    fatal: function() {
      logs.push(fastlog.fatal.apply(logger, arguments));
    },

    logs: function() {
      return logs.join('\n');
    }

  };

  return logger;
}
