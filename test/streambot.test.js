var tape = require('tape');
var AWS = require('aws-sdk');
var streambot = require('..');
var util = require('util');

// mock dynamodb client
function test(name, assertions) {
  var dynamodb = AWS.DynamoDB;

  tape(name, function(t) {
    AWS.DynamoDB = function() {};

    AWS.DynamoDB.prototype.getItem = function(params, callback) {
      callback(null, {
        Item: {
          env: { S: JSON.stringify({ var: 'value' }) }
        }
      });
    };

    var done = t.end.bind(t);
    t.end = function(err) {
      AWS.DynamoDB = dynamodb;
      if (err) return done(err);
      done();
    };

    assertions(t);
  });
}

test('sets env vars', function(assert) {
  var fn = streambot(function(event, callback) {
    assert.equal(process.env.var, 'value', 'sets env var');
    callback();
  });

  fn({}, {
    done: assert.end.bind(assert),
    getRemainingTimeInMillis: function() { return 10000; }
  });
});

test('sets context', function(assert) {
  var fn = streambot(function(event, callback) {
    assert.equal(this.val, 'value', 'sets context');
    callback();
  });

  fn({}, {
    done: assert.end.bind(assert),
    val: 'value',
    getRemainingTimeInMillis: function() { return 10000; }
  });
});

test('passes event', function(assert) {
  var expected = { val: 'value' };
  var fn = streambot(function(event, callback) {
    assert.deepEqual(event, expected, 'passes event');
    callback();
  });

  fn(expected, {
    done: assert.end.bind(assert),
    getRemainingTimeInMillis: function() { return 10000; }
  });
});

test('implements timeout log', function(assert) {
  assert.plan(1);

  var log = console.log;
  console.log = function(msg) {
    log(util.format.apply(null, arguments));
    if (msg === '[timeout] Function will timeout in 200ms')
      assert.pass('logs timeout');
  };

  var fn = streambot(function(event, callback) {
    setTimeout(callback, 500);
  });

  fn({}, {
    done: function() { console.log = log; },

    getRemainingTimeInMillis: function() { return 10; }
  });
});
