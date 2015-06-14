// # Streambot
var url = require('url');
var https = require('https');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

// ## Exports
// - `require('streambot')` provides a function for you to wrap your own Lambd function with.
module.exports = streambot;

// - `require('streambot').env` provides a function to write configuration to files on S3
module.exports.env = manageEnv;

// - `require('streambot').connector` provides a function to manage event source mappings
module.exports.connector = manageConnector;

// ## Streambot wrapper
// Pass the function you want to run on Lambda, and optionally the location where you've stored environment configuration on S3.
// This loads the configuration from your S3 file into environment variables which will be accessible to your function.
function streambot(service, envUrl) {

  // A function is returned which is *what Lambda will actually execute*.
  return function streambot(event, context) {

    // Provides the `context.done` function as a familiar Node.js-style callback function.
    var callback = context.done.bind(context);

    // If there was no configuration file provided, simply call the caller-provided function, passing the event and the callback.
    if (!envUrl) return service(event, callback);

    // Otherwise, load environment from S3.
    envUrl = url.parse(envUrl);
    console.log('Load environment from %s', envUrl);

    s3.getObject({
      Bucket: envUrl.hostname,
      Key: envUrl.pathname.slice(1)
    }, function(err, data) {

      // If the configuration file does not exist, the Lambda execution **will not** be retried.
      if (err) return callback(err);

      // Read the configuration file and set key-value pairs as environment variables.
      var env = JSON.parse(data.Body);
      Object.keys(env).forEach(function(key) {
        process.env[key] = env[key];
      });

      // Run the caller-provided function with the environment properly configured.
      service(event, callback);
    });
  };
}

// ## Validate Events
// Helper function confirms that an event is a [CloudFormation event](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-requests.html).
function isCloudFormationEvent(event) {
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

// ## respond
// Helper function for responding to a Lambda invocation triggered by a custom CloudFormation resource.
// The function will be passed a signed S3 URL, and the custom resource will wait for a file to be PUT there, indicating if the resource successfully completed or not.
// Parameters:
// - err: an Error object indicating that a failure occurred
// - data: key-value pairs to make accessible via `Fn::GetAtt` in the CloudFormation template defining the resource
// - event: the event that triggered Lambda invocation
// - context: the context provided by the Lambda invocation
function respond(err, data, event, context) {

  // Status is determined simply by the presence or absence of an `err` object.
  if (err) console.log(err);
  var status = err ? 'FAILED' : 'SUCCESS';

  // Build the required response. See [the AWS documentation](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html) for more information.
  var body = JSON.stringify({
    Status: status,
    Reason: err ? err.message : '',
    PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    LogicalResourceId: event.LogicalResourceId,
    RequestId: event.RequestId,
    Data: data
  });

  // Build request options to send the response to the provided S3 URL.
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

  // Send the response, log the result, and retry 5 times on error before giving up.
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

// ## Manage configuration files
// This function writes configuration files to S3.
// It expects to be invoked by a custom CloudFormation resource.
// This resource **must** provide an `EnvUrl`, where the file will be written.
// Any other properties provided to the custom CloudFormation resource will become key-value pairs in the configuration file.
function manageEnv(event, context) {
  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

  // Check that the custom CloudFormation resource was given the required properties.
  if (!event.ResourceProperties.EnvUrl)
    return respond(new Error('Invalid StreambotEnv parameters'), null, event, context);

  // Log information about what we're doing.
  console.log('%s config for %s', event.RequestType, event.StackId);

  // Determine where to put the configuration file.
  var parsedUrl = url.parse(event.ResourceProperties.EnvUrl);
  var s3Params = {
    Bucket: parsedUrl.hostname,
    Key: parsedUrl.pathname.slice(1)
  };

  // The custom CloudFormation resource is being deleted. Remove the config file from S3.
  if (event.RequestType === 'Delete') return s3.deleteObject(s3Params, function(err) {
    respond(err, null, event, context);
  });

  // The custom CloudFormation resource is being created or updated. PUT the config to S3.
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

// ## Manage event source mappings
// This function writes event source mappings between Kinesis/DynamoDB streams and Lambda functions.
// It expects to be invoked by a custom CloudFormation resource.
// This resource **must** provide:
// - FunctionRegion: the AWS region containing the Lambda function
// - FunctionName: the name of the Lambda function
// - StreamArn: the ARN for the stream
//
// Other properties that **may be** provided:
// - BatchSize [100]: the maximum number of stream records to process in a single Lambda invocation
// - StartingPosition [TRIM_HORIZON]: the stream iterator type
// - Enabled [true]: whether or not the event source mapping is active
function manageConnector(event, context) {
  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

  // Check that the custom CloudFormation resource was given the right properties.
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

  // Log information about what we're doing.
  console.log(
    '%s eventSourceMapping for %s: %s - %s',
    event.RequestType,
    event.StackId,
    event.ResourceProperties.StreamArn,
    event.ResourceProperties.FunctionName
  );

  // Check for an existing mapping between this stream - function.
  var lambda = new AWS.Lambda({ region: event.ResourceProperties.FunctionRegion });
  lambda.listEventSourceMappings({
    EventSourceArn: event.ResourceProperties.StreamArn,
    FunctionName: event.ResourceProperties.FunctionName
  }, function(err, data) {

    // The custom CloudFormation resource may have been misconfigured at create/update time (e.g. invalid Stream ARN value).
    // In this case a `Delete` on this custom resource must succeed, even if the create or update failed in the first place.
    if (err && event.RequestType === 'Delete') return respond(null, null, event, context);

    // If there is an error during a create/update, mark the action as a failure.
    if (err) return respond(err, null, event, context);

    // Determine if this mapping already exists.
    var existingUUID = data.EventSourceMappings.length ?
      data.EventSourceMappings[0].UUID : null;

    // Perform a delete if an existing mapping was found.
    if (event.RequestType === 'Delete') {
      if (!existingUUID) return respond(null, null, event, context);
      return lambda.deleteEventSourceMapping({ UUID: existingUUID }, function(err) {
        respond(err, null, event, context);
      });
    }

    // Build event source mapping request parameters.
    var params = {
      FunctionName: event.ResourceProperties.FunctionName,
      BatchSize: event.ResourceProperties.BatchSize || 100,
      Enabled: event.ResourceProperties.hasOwnProperty('Enabled') ?
        event.ResourceProperties.Enabled : true
    };

    // Account for differences between creating and updating an event source mapping.
    if (existingUUID) {
      params.UUID = existingUUID;
    } else {
      params.StartingPosition = event.ResourceProperties.StartingPosition || 'TRIM_HORIZON';
      params.EventSourceArn = event.ResourceProperties.StreamArn;
    }

    // Create or update the mapping.
    var action = existingUUID ? 'updateEventSourceMapping' : 'createEventSourceMapping';
    lambda[action](params, function(err, data) {
      respond(err, data ? { UUID: data.UUID } : null, event, context);
    });
  });
}
