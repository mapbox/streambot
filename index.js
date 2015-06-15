var url = require('url');
var https = require('https');
var AWS = require('aws-sdk');
var dynamodb = new AWS.DynamoDB({ region: 'us-east-1' });

module.exports = streambot;
module.exports.env = manageEnv;
module.exports.connector = manageConnector;

function streambot(service) {
  return function streambot(event, context) {
    var callback = context.done.bind(context);

    var getParams = {
      TableName: 'streambot-env',
      Key: { name: { S: context.functionName } }
    };

    dynamodb.getItem(getParams, function(err, record) {
      if (err) return callback(err);
      if (!record) return service(event, callback);

      var env = JSON.parse(record.env.S);
      Object.keys(env).forEach(function(key) {
        process.env[key] = env[key];
      });

      service(event, callback);
    });
  };
}

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

function respond(err, data, event, context) {
  if (err) console.log(err);
  var status = err ? 'FAILED' : 'SUCCESS';

  var body = JSON.stringify({
    Status: status,
    Reason: err ? err.message : '',
    PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    LogicalResourceId: event.LogicalResourceId,
    RequestId: event.RequestId,
    Data: data
  });

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

  if (!event.ResourceProperties.FunctionName)
    return respond(new Error('Invalid StreambotEnv parameters'), null, event, context);

  console.log('%s config for %s', event.RequestType, event.ResourceProperties.FunctionName);

  if (event.RequestType === 'Delete') return dynamodb.deleteItem({
    TableName: 'streambot-env',
    Key: { name: { S: event.ResourceProperties.FunctionName } }
  }, function(err) {
    respond(err, null, event, context);
  });

  var env = Object.keys(event.ResourceProperties).reduce(function(env, key) {
    if (key !== 'ServiceToken' && key !== 'FunctionName')
      env[key] = event.ResourceProperties[key];
    return env;
  }, {});

  dynamodb.putItem({
    TableName: 'streambot-env',
    Item: {
      name: { S: event.ResourceProperties.FunctionName },
      env: { S: JSON.stringify(env) }
    }
  }, function(err) {
    respond(err, null, event, context);
  });
}

function manageConnector(event, context) {
  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

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

  console.log(
    '%s eventSourceMapping for %s: %s - %s',
    event.RequestType,
    event.StackId,
    event.ResourceProperties.StreamArn,
    event.ResourceProperties.FunctionName
  );

  var lambda = new AWS.Lambda({ region: event.ResourceProperties.FunctionRegion });
  lambda.listEventSourceMappings({
    EventSourceArn: event.ResourceProperties.StreamArn,
    FunctionName: event.ResourceProperties.FunctionName
  }, function(err, data) {
    if (err && event.RequestType === 'Delete') return respond(null, null, event, context);
    if (err) return respond(err, null, event, context);

    var existingUUID = data.EventSourceMappings.length ?
      data.EventSourceMappings[0].UUID : null;

    if (event.RequestType === 'Delete') {
      if (!existingUUID) return respond(null, null, event, context);
      return lambda.deleteEventSourceMapping({ UUID: existingUUID }, function(err) {
        respond(err, null, event, context);
      });
    }

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

    var action = existingUUID ? 'updateEventSourceMapping' : 'createEventSourceMapping';
    lambda[action](params, function(err, data) {
      respond(err, data ? { UUID: data.UUID } : null, event, context);
    });
  });
}
