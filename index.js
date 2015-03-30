var AWS = require('aws-sdk');

module.exports = function(service) {
  return function streambot(event, context) {
    function callback(err) {
      if (err) console.log(err);

      var cloudwatch = new AWS.CloudWatch();
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

      cloudwatch.putMetricData(params, function(error) {
        if (error) console.log(error);
        else console.log('putMetricData ' + JSON.stringify(params));
        context.done(err, 'Processed events: ' + eventIds.join(' '));
      });
    }

    console.log(JSON.stringify(event));

    var records = event.Records
      .filter(function(record) {
        return record.eventName === 'aws:kinesis:record';
      }).map(function(record) {
        record.kinesis.data = new Buffer(record.kinesis.data, 'base64').toString();
        return record.kinesis;
      });

    require('dotenv').load();

    service(records, callback);
  };
};
