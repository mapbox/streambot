var https = require('https');
var url = require('url');
var AWS = require('aws-sdk');

module.exports = function(event, context) {
  // Confirm that the message is a CFN event
  // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-requests.html
  var required = [
    'RequestType',
    'ResourceProperties',
    'StackId',
    'LogicalResourceId',
    'RequestId',
    'ResponseURL',
  ];

  var valid = required.reduce(function(valid, key) {
    if (!(key in event)) return false;
    return key;
  }, true);

  // If it is not a CFN event, we have nowhere to report. Drop the event.
  if (!valid) return context.done(null, 'ERROR: Invalid CloudFormation event');

  // Check that the custom CFN resource was given the right properties
  var requiredProperties = [
    'FunctionRegion',
    'FunctionName',
    'StreamArn'
  ];

  valid = requiredProperties.reduce(function(valid, key) {
    if (!(key in event.ResourceProperties)) return false;
    return key;
  }, true);

  if (!valid)
    return respond(new Error('Invalid StreambotConnector Parameters'));

  // Log information about what we're doing
  console.log(
    '%s eventSourceMapping for %s: %s - %s',
    event.RequestType,
    event.StackId,
    event.ResourceProperties.StreamArn,
    event.ResourceProperties.FunctionName
  );

  // Check for an existing mapping
  var lambda = new AWS.Lambda({ region: event.ResourceProperties.FunctionRegion });
  lambda.listEventSourceMappings({
    EventSourceArn: streamArn,
    FunctionName: fnName
  }, function(err, data) {
    if (err) return respond(err);

    var existingUUID = data.EventSourceMappings.length ?
      data.EventSourceMappings[0].UUID : null;

    // Perform a delete if an existing mapping was found
    if (event.RequestType === 'Delete') {
      if (!existingUUID) return respond();
      return lambda.deleteEventSourceMapping({ UUID: existingUUID }, respond);
    }

    // Build event source mapping request parameters
    var params = {
      FunctionName: event.ResourceProperties.FunctionName,
      BatchSize: event.ResourceProperties.BatchSize || 100,
      Enabled: event.ResourceProperties.hasOwnProperty('Enabled') ?
        event.ResourceProperties.Enabled : true
    };

    if (existingUUID) {
      params.UUID = existingUUID;
    } else {
      params.StartingPosition = event.ResourceProperties.StartingPosition || 'TRIM_HORIZON';
      params.EventSourceArn = event.ResourceProperties.StreamArn;
    }

    // Create or update the mapping
    var action = existingUUID ? 'updateEventSourceMapping' : 'createEventSourceMapping';
    lamba[action](params, function(err, data) {
      respond(err, data.UUID);
    });
  });

  // Function to respond to CFN
  function respond(err, id) {
    if (err) console.log(err);

    var status = err ? 'FAILED': 'SUCCESS';

    // Build the required response
    // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html
    var body = JSON.stringify({
      Status: status,
      Reason: err ? err.message : '',
      PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
      StackId: event.StackId,
      LogicalResourceId: event.LogicalResourceId,
      RequestId: event.RequestId,
      Data: { EventSourceMappingUUID: id }
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
        attempts++;
        sendResponse(attempts);
      });

      req.write(body);
      req.end();
    })(0);
  }
};
