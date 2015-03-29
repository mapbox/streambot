var AWS = require('aws-sdk');

module.exports = function(records, callback) {
  var s3 = new AWS.S3();

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
};
