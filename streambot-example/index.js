var AWS = require('aws-sdk');
var streambot = require('streambot');

exampleEnv = 's3://mapbox/envs/streambot-example/example';
module.exports.streambot = streambot(exampleService, exampleEnv);

function exampleService(event, callback) {
  var s3 = new AWS.S3();

  console.log(process.env);

  var record = event.Records.shift();
  if (record) uploadRecord(record);

  function uploadRecord(record) {
    s3.putObject({
      Bucket: process.env.EventBucket,
      Key: process.env.EventPrefix + '/' + record.kinesis.sequenceNumber,
      Body: new Buffer(record.kinesis.data, 'base64')
    }, function(err) {
      if (err) return callback(err);

      var record = event.Records.shift();
      if (record) uploadRecord(record);
      else callback();
    });
  }
}
