var url = require('url');
var https = require('https');
var AWS = require('aws-sdk');
var AgentKeepAlive = require('agentkeepalive');
var crypto = require('crypto');

module.exports = streambot;
module.exports.env = manageEnv;
module.exports.connector = manageConnector;
module.exports.agent = new AgentKeepAlive.HttpsAgent({
  keepAlive: true,
  maxSockets: Math.ceil(require('os').cpus().length * 16),
  keepAliveTimeout: 60000
});

var tableName = module.exports.tableName = 'streambot-env';

function streambot(service) {
  var dynamodb = new AWS.DynamoDB({
    region: 'us-east-1',
    maxRetries: 1000,
    httpOptions: {
      timeout: 500,
      agent: module.exports.agent
    }
  });

  return function streambot(event, context) {
    console.log('Start time: %s', (new Date()).toISOString());
    console.log('Event md5: %s', crypto.createHash('md5').update(JSON.stringify(event)).digest('hex'));

    var callback = context.done.bind(context);

    var getParams = {
      TableName: tableName,
      Key: { name: { S: context.functionName } }
    };

    dynamodb.getItem(getParams, function(err, data) {
      if (err) {
        console.log('[error] Failed to load environment: %s', err.message);
        return context.fail(err);
      }

      if (!data.Item) {
        console.log('No environment found!');
        return service.call(context, event, callback);
      }

      console.log('Loaded environment: %s', JSON.stringify(getParams));

      var env = JSON.parse(data.Item.env.S);
      Object.keys(env).forEach(function(key) {
        process.env[key] = env[key];
      });

      service.call(context, event, callback);
    }).on('retry', function(res) {
      if (res.error) {
        console.log('[failed request] dynamodb.getItem | %s | request id: %s | retries: %s',
          res.error.code, res.requestId, res.retryCount
        );

        // Other errors automatically retryable by aws-sdk:
        // https://github.com/aws/aws-sdk-js/blob/d20ddadd7ac39b81f4262cacd1ad29813988bf84/lib/service.js#L314-L320
        if (res.error.name === 'TimeoutError') res.error.retryable = true;
      }
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

  if (err && !err.message) {
    err.message = 'An unexpected error occurred';
    if (err.code) err.message += ': ' + err.code;
  }

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
  var dynamodb = new AWS.DynamoDB({
    region: 'us-east-1',
    maxRetries: 1000,
    httpOptions: {
      timeout: 500,
      agent: module.exports.agent
    }
  });

  if (!isCloudFormationEvent(event))
    return context.done(null, 'ERROR: Invalid CloudFormation event');

  if (!event.ResourceProperties.FunctionName)
    return respond(new Error('Invalid StreambotEnv parameters'), null, event, context);

  console.log('%s config for %s', event.RequestType, event.ResourceProperties.FunctionName);

  if (event.RequestType === 'Delete') return dynamodb.deleteItem({
    TableName: tableName,
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
    TableName: tableName,
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
