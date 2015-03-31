var AWS = require('aws-sdk');
var streambot = require('streambot');

module.exports.streambot = streambot(exampleService);

function exampleService(records, callback) {
  var s3 = new AWS.S3();

  streambot.log.info(process.env);

  var record = records.shift();
  if (record) uploadRecord(record);

  function uploadRecord(record) {
    s3.putObject({
      Bucket: 'mapbox',
      Key: 'example-records/' + record.sequenceNumber,
      Body: record.data
    }, function(err) {
      if (err) return callback(err);

      var record = records.shift();
      if (record) uploadRecord(record);
      else callback();
    });
  }
}
