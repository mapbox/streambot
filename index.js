var url = require('url');
var https = require('https');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

module.exports = streambot;
module.exports.env = manageEnv;
module.exports.connector = manageConnector;

function streambot(service, envUrl) {
  return function streambot(event, context) {
    var callback = context.done.bind(context);

    if (!envUrl) return service(event, callback);

    envUrl = url.parse(envUrl);

    s3.getObject({
      Bucket: envUrl.hostname,
      Key: envUrl.pathname.slice(1)
    }, function(err, data) {
      if (err) return callback(err, 'Failed to load environment from S3');

      var env = JSON.parse(data.Body);
      Object.keys(env).forEach(function(key) {
        process.env[key] = env[key];
      });

      service(event, callback);
    });
  };
}

function isCloudFormationEvent(event) {
  // Confirm that the message is a CFN event
  // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-requests.html
  var required = [
    'RequestType',
    'ResourceProperties',
    'StackId',
    'LogicalResourceId',
    'RequestId',
    'ResponseURL'
  ];

  return required.reduce(function(valid, key) {
    if (!(key in event)) return false;
    return key;
  }, true);
}

function respond(err, data, event, context) {
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
    Data: data
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

function manageEnv(event, context) {
  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

  // Check that the custom CFN resource was given the right properties
  if (!event.ResourceProperties.EnvUrl)
    return respond(new Error('Invalid StreambotEnv parameters'), null, event, context);

  // Log information about what we're doing
  console.log('%s config for %s', event.RequestType, event.StackId);

  var parsedUrl = url.parse(event.ResourceProperties.EnvUrl);
  var s3Params = {
    Bucket: parsedUrl.hostname,
    Key: parsedUrl.pathname.slice(1)
  };

  // CFN resource is being deleted. Remove the config from S3
  if (event.RequestType === 'Delete') return s3.deleteObject(s3Params, function(err) {
    respond(err, null, event, context);
  });

  // CFN resource is being created or updated. PUT the config to S3
  var env = Object.keys(event.ResourceProperties).reduce(function(env, key) {
    if (key !== 'ServiceToken' && key !== 'EnvUrl')
      env[key] = event.ResourceProperties[key];
    return env;
  }, {});

  s3Params.Body = JSON.stringify(env);
  s3.putObject(s3Params, function(err) {
    respond(err, { EnvUrl: event.ResourceProperties.EnvUrl }, event, context);
  });
}

function manageConnector(event, context) {
  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

  // Check that the custom CFN resource was given the right properties
  var requiredProperties = [
    'FunctionRegion',
    'FunctionName',
    'StreamArn'
  ];

  var valid = requiredProperties.reduce(function(valid, key) {
    if (!(key in event.ResourceProperties)) return false;
    return key;
  }, true);

  if (!valid)
    return respond(new Error('Invalid StreambotConnector parameters'), null, event, context);

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
    EventSourceArn: event.ResourceProperties.StreamArn,
    FunctionName: event.ResourceProperties.FunctionName
  }, function(err, data) {
    if (err) return respond(err, null, event, context);

    var existingUUID = data.EventSourceMappings.length ?
      data.EventSourceMappings[0].UUID : null;

    // Perform a delete if an existing mapping was found
    if (event.RequestType === 'Delete') {
      if (!existingUUID) return respond(null, null, event, context);
      return lambda.deleteEventSourceMapping({ UUID: existingUUID }, function(err) {
        respond(err, null, event, context);
      });
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
    lambda[action](params, function(err, data) {
      respond(err, { UUID: data.UUID }, event, context);
    });
  });
}
