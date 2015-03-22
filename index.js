var crypto = require('crypto');
var AWS = require('aws-sdk');
var service = require('${service}');

module.exports.streambot = function(event, context) {
  var jobid = crypto.randomBytes(8).toString('hex');
  var log = {
    error: function(msg) { console.error('[%s] %s', jobid, msg); },
    warn: function(msg) { console.error('[%s] %s', jobid, msg); },
    info: function(msg) { console.log('[%s] %s', jobid, msg); },
    debug: function(msg) { console.log('[%s] %s', jobid, msg); }
  };

  function callback(err) {
    if (err) log.error(err);

    var cloudwatch = new AWS.CloudWatch();
    var params = {
      Namespace: 'streambot',
      MetricData: [
        {
          MetricName: '${metric}',
          Value: 1,
          Dimensions: [{ Name: 'Status' }]
        }
      ]
    };

    params.MetricData[0].Dimensions[0].Value = err ? 'Error' : 'Success';

    cloudwatch.putMetricData(params, function(error, data) {
      if (error) log.error(error);
      else if (!err) log.info('putMetricData ' + JSON.stringify(params));
      context.done();
    });
  }

  service(event, callback);
};
