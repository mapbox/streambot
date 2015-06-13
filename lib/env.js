var https = require('https');
var url = require('url');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

module.exports = function(event, context) {
  // Confirm that the message is of the expected format
  // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-requests.html
  var required = [
    'RequestType',
    'ResourceProperties',
    'StackId',
    'LogicalResourceId',
    'RequestId',
    'ResponseURL'
  ];

  var valid = required.reduce(function(valid, key) {
    if (!(key in event)) return false;
    return key;
  }, true);

  // If it is not a CFN event, we have nowhere to report. Drop the event.
  if (!valid) return context.done(null, 'ERROR: Invalid CloudFormation event');

  // If it is a CFN event, but lacks the URL to which .env should be written,
  // respond to CFN with a failure
  if (!event.ResourceProperties.EnvUrl)
    return respond(new Error('Invalid CloudFormation event'));

  // Log information about what we're doing
  console.log('%s .env for %s', event.RequestType, event.StackId);

  var parsedUrl = url.parse(event.ResourceProperties.EnvUrl);
  var s3Params = {
    Bucket: parsedUrl.hostname,
    Key: parsedUrl.pathname.slice(1)
  };

  // CFN resource is being deleted. Remove the .env from S3
  if (event.RequestType === 'Delete') return s3.deleteObject(s3Params, respond);

  // CFN resource is being created or updated. PUT the .env to S3
  var env = Object.keys(event.ResourceProperties).reduce(function(env, key) {
    if (key !== 'ServiceToken' && key !== 'EnvUrl')
      env[key] = event.ResourceProperties[key];
    return env;
  }, {});

  s3Params.Body = JSON.stringify(env);
  s3.putObject(s3Params, respond);

  // Function to respond to CFN
  function respond(err) {
    if (err) console.log(err);

    var status = err ? 'FAILED' : 'SUCCESS';

    // Build the required response
    // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html
    var body = JSON.stringify({
      Status: status,
      Reason: err ? err.message : '',
      PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
      StackId: event.StackId,
      LogicalResourceId: event.LogicalResourceId,
      RequestId: event.RequestId,
      Data: {
        EnvUrl: event.ResourceProperties.EnvUrl
      }
    });

    // Build request options to send the response
    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: {
        'content-type': '',
        'content-length': body.length
      }
    };

    console.log('Send response to: %j', options);
    console.log('Response body: %s', body);

    // Send the response, log the result, retry 5 times on error before giving up
    (function sendResponse(attempts) {
      if (attempts > 5) return context.done(new Error('Failed to respond to CloudFormation'));

      var req = https.request(options, function(res) {
        console.log('Response status: ' + res.statusCode);
        console.log('Response headers: ' + JSON.stringify(res.headers));
        context.done(null, err || body);
      }).on('error', function(err) {
        console.log(err);
        attempts++;
        sendResponse(attempts);
      });

      req.write(body);
      req.end();
    })(0);
  }
};
