var tape = require('tape');
var AWS = require('aws-sdk');
var streambot = require('..');
var events = require('events');
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
      return new events.EventEmitter();
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

test('logs md5', function(assert) {
  var log = console.log;
  var messages = [];
  console.log = function() {
    messages.push(util.format.apply(null, arguments));
  };

  var fn = streambot(function(event, callback) {
    callback();
  });

  fn({ banana: 'pajamas' }, {
    done: function() {
      console.log = log.bind(console);
      assert.ok(messages.indexOf('Event md5: 768bc7325b3d2eff12ed9ecbd7f471f3') > -1, 'printed md5 of event');
      assert.end();
    },

    getRemainingTimeInMillis: function() { return 10000; }
  });
});
