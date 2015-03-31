var test = require('tape');
var stack = require('cfn-test')('streambot', 'us-east-1');
var path = require('path');
var fs = require('fs');
var exec = require('child_process').exec;
var AWS = require('aws-sdk');
var deploy = require('../bin/deploy');

var example = path.resolve(__dirname, '..', 'streambot-example');
var template = path.join(example, 'streambot-example.template');
template = JSON.parse(fs.readFileSync(template, 'utf8'));

// Deploy script is executed from the service's root dir
process.chdir(example);

stack.start(template);

test('[deploy] getStackOutputs', function(assert) {
  deploy.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    assert.ifError(err, 'got stack outputs');

    var keys = Object.keys(outputs);
    assert.ok(keys.indexOf('KinesisStream') > -1, 'found KinesisStream output');
    assert.ok(keys.indexOf('LambdaInvocationRole') > -1, 'found LambdaInvocationRole output');
    assert.ok(keys.indexOf('LambdaExecutionRole') > -1, 'found LambdaExecutionRole output');
    assert.ok(keys.indexOf('LambdaExecutionRoleName') > -1, 'found LambdaExecutionRoleName output');
    assert.ok(keys.indexOf('KinesisAdminRole') > -1, 'found KinesisAdminRole output');
    assert.ok(keys.indexOf('MetricName') > -1, 'found MetricName output');

    assert.end();
  });
});

test('[deploy] getStackParameters', function(assert) {
  deploy.getStackParameters(stack.stackName, 'us-east-1', function(err, params) {
    assert.ifError(err, 'got stack parameters');
    assert.deepEqual(params, {});
    assert.end();
  });
});

test('[deploy] getStackResources', function(assert) {
  deploy.getStackResources(stack.stackName, 'us-east-1', function(err, resources) {
    assert.ifError(err, 'got stack resources');

    var keys = Object.keys(resources);
    assert.ok(keys.indexOf('StreambotStack') > -1, 'found StreambotStack resource');
    assert.ok(keys.indexOf('LambdaPolicy') > -1, 'found LambdaPolicy resource');
    assert.end();
  });
});

test('[deploy] wrap', function(assert) {
  var env = {
    SomeVariable: 'some value',
    Another: 'variable'
  };

  if (fs.existsSync('.env')) fs.unlinkSync('.env');

  deploy.wrap(env, function(err) {
    assert.ifError(err, 'wrapped');

    assert.ok(fs.existsSync('.env'), 'created .env');
    var dotenv = fs.readFileSync('.env', 'utf8');

    assert.equal(dotenv, 'SomeVariable=some value\nAnother=variable\n', 'correct .env file');

    assert.end();
  });
});

test('[deploy] npm install', function(assert) {
  exec('npm install', { cwd: example }, function(err, stdout, stderr) {
    if (err) {
      console.log(stdout);
      console.log(stderr);
      throw err;
    }

    assert.end();
  });
});

test('[deploy] bundle', function(assert) {
  var zip = path.join('build', 'bundle.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  deploy.bundle(function(err) {
    assert.ifError(err, 'bundled');
    assert.ok(fs.existsSync(zip), 'created bundle');
    assert.end();
  });
});

test('[deploy] uploadFunction', function(assert) {
  deploy.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    if (err) throw err;

    deploy.uploadFunction(
      'us-east-1',
      stack.stackName,
      path.resolve(__dirname, 'fixtures', 'bundle.zip'),
      'index.js',
      outputs.LambdaExecutionRole,
      'test function',
      uploaded
    );

    function uploaded(err, arn) {
      assert.ifError(err, 'uploaded function');

      var lambda = new AWS.Lambda({ region: 'us-east-1' });
      lambda.listFunctions({}, function(err, data) {
        if (err) throw err;

        var fn = data.Functions.filter(function(fn) {
          return fn.FunctionARN === arn;
        })[0];

        assert.ok(fn, 'function was uploaded');

        lambda.deleteFunction({ FunctionName: fn.FunctionName }, function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    }
  });
});

test('[deploy] setEventSource', function(assert) {
  deploy.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    if (err) throw err;

    deploy.uploadFunction(
      'us-east-1',
      stack.stackName,
      path.resolve(__dirname, 'fixtures', 'bundle.zip'),
      'index.js',
      outputs.LambdaExecutionRole,
      'test function',
      uploaded
    );

    function uploaded(err) {
      if (err) throw err;

      deploy.setEventSource(
        'us-east-1',
        outputs.KinesisStream,
        stack.stackName,
        outputs.LambdaInvocationRole,
        evented
      );
    }

    function evented(err, uuid) {
      assert.ifError(err, 'set event source');

      var lambda = new AWS.Lambda({ region: 'us-east-1' });
      lambda.getEventSource({ UUID: uuid }, function(err) {
        assert.ifError(err, 'got event source');

        lambda.deleteFunction({ FunctionName: stack.stackName }, function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    }
  });
});

test('[deploy] deploy', function(assert) {
  var lambda = new AWS.Lambda({ region: 'us-east-1' });
  var fnName = stack.stackName;
  var environment = stack.stackName.split('-').pop();

  deploy.deploy(
    'test-streambot',
    'index.js',
    environment,
    'us-east-1',
    'description for ' + stack.stackName,
    deployed
  );

  function deployed(err) {
    assert.ifError(err, 'deployed');

    lambda.listFunctions({}, function(err, data) {
      if (err) throw err;

      var fnDescription = data.Functions.filter(function(fn) {
        return fn.FunctionName === fnName;
      })[0];

      assert.ok(fnDescription, 'uploaded function');

      lambda.listEventSources({
        FunctionName: fnName
      }, function(err, data) {
        assert.ifError(err, 'listed event sources');
        assert.equal(data.EventSources.length, 1, 'attached event source');

        invoke();
      });
    });
  }

  function invoke() {
    var e = require(path.resolve(__dirname, 'fixtures', 'event.json'));

    lambda.invokeAsync({
      FunctionName: fnName,
      InvokeArgs: new Buffer(JSON.stringify(e))
    }, function(err, data) {
      assert.ifError(err, 'could invoke function');
      assert.equal(data.Status, 202, 'invoked successfully');

      lambda.deleteFunction({ FunctionName: fnName }, function(err) {
        if (err) throw err;
        assert.end();
      });
    });
  }
});

test('[deploy] via npm run', function(assert) {
  var lambda = new AWS.Lambda({ region: 'us-east-1' });
  var environment = stack.stackName.split('-').pop();

  exec('npm run deploy ' + environment, function(err, stdout, stderr) {
    assert.ifError(err, 'deployed');

    if (err) {
      console.log(stdout);
      console.log(stderr);
    }

    lambda.listFunctions({}, function(err, data) {
      if (err) throw err;

      var fnDescription = data.Functions.filter(function(fn) {
        return fn.FunctionName === stack.stackName;
      })[0];

      assert.ok(fnDescription, 'uploaded function');

      lambda.deleteFunction({ FunctionName: stack.stackName }, function(err) {
        if (err) throw err;
        assert.end();
      });
    });
  });
});

stack.delete();
