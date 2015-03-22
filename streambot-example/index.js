var AWS = require('aws-sdk');

module.exports = function(records, callback) {
  var s3 = new AWS.S3();

  var record = records.shift();
  if (record) uploadRecord(record);

  function uploadRecord(record) {
    s3.putObject({
      Bucket: 'my-bucket',
      Key: 'example-records/' + record.id,
      Body: new Buffer(JSON.stringify(record))
    }, function(err) {
      if (err) return callback(err);
      var record = records.shift();
      if (record) uploadRecord(record);
    });
  }
};
