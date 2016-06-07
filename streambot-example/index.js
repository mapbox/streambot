// # Streambot Example Code
// This file performs the work performed by the primary Lambda function defined by the streambot-example.template. It simply receives Kinesis records and writes them to S3.
// This code must be bundled into a .zip file and uploaded to S3, and that S3 location refered to in the streambot-example.template.

var AWS = require('aws-sdk');
var streambot = require('streambot');

// ## The Streambot wrapper
// To use Streambot, we pass it the function that defines our work.
// This returns a function which is what Lambda executes. Hence, the `Handler` we use in streambot-example.template is `index.streambot`.
module.exports.streambot = streambot(exampleService);

// ## The work to do
// Streambot will call your function, passing two arguments:
// - event: the event that triggered this Lambda invocation
// - callback: a function to handle the outcome of your work, using the familiar Node.js pattern of err, response.
function exampleService(event, callback) {
  // Before calling your function, Streambot will have loaded configuration from the provided URL into the environment.
  console.log(process.env);

  var s3 = new AWS.S3({ region: process.env.EventBucketRegion });

  // Pluck the first Kinesis record from the given event, and run it
  var record = event.Records.shift();
  if (record) uploadRecord(record);

  // ## Running a single record
  function uploadRecord(record) {
    // Simply write the record to an S3 location defined by runtime configuration
    s3.putObject({
      Bucket: process.env.EventBucket,
      Key: process.env.EventPrefix + '/' + record.kinesis.sequenceNumber,
      Body: new Buffer(record.kinesis.data, 'base64')
    }, function(err) {
      // If there was an error writing the record, passing it off to the callback function will be treated as a "handled" exception. Lambda invocation will stop, and this event will not be retried.
      if (err) return callback(err);

      // Continue processing records as long as there are any left in the event.
      var record = event.Records.shift();
      if (record) uploadRecord(record);

      // Once everything has been processed, fire the callback function to complete the Lambda invocation.
      else callback();
    });
  }
}
