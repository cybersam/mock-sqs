var extend = require( 'extend' );
var uuid = require( 'node-uuid' );
var util = require('util');

var queues = {};
var mock_opts;
module.exports.SQS = SQS;
module.exports.reset = function () {
    queues = {};
}
module.exports.setMockOpts = function (opts) {
  mock_opts = opts;
};
module.exports.createQueue = createQueue;

function createQueue( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var qname = params.QueueName;
    if ( !params.QueueName ) {
        callback( new Error( 'QueueName is required' ) );
        return;
    }

    var region = (this.config && this.config.region) || undefined;
    var accountId = (mock_opts && mock_opts.accountId) || '123456789';
    var baseUrl = (mock_opts && mock_opts.baseUrl) || undefined;
    var qurl = baseUrl ?
      util.format('%s%s%s/%s', baseUrl, baseUrl.endsWith('/') ? '' : '/', accountId, qname) :
      util.format('https://sqs.%s.amazonaws.com/%s/%s', region, accountId, qname);
    
      console.log(qurl);
      
    if ( queues[ qurl ] ) {
        callback( new Error( 'Queue "' + qname + '" already exists' ) );
        return;
    }

    var attributes = extend({
        DelaySeconds: 0,
        MaximumMessageSize: 262144,
        MessageRetentionPeriod: 345600,
        ReceiveMessageWaitTimeSeconds: 0,
        VisibilityTimeout: 30,
        CreatedTimestamp: new Date().getTime()
    }, params.Attributes );

    queues[ qurl ] = {
        name: qname,
        attributes: attributes,
        messages: []
    }

    setTimeout( function () {
        callback( null, {
            QueueUrl: qurl
        })
    })
}

function SQS ( options ) {
    options = options || {};
    this.config = extend({
        region: 'us-east-1'
    }, options );
    this.params = options.params || {};
}

SQS.prototype.createQueue = createQueue;

SQS.prototype.getQueueAttributes = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var qurl = params.QueueUrl;
    if ( !qurl ) {
        callback( new Error( 'QueueUrl is required' ) )
        return
    }

    var queue = queues[ qurl ];
    if ( !queue ) {
        callback( new Error( 'Queue doesn\'t exist for Url:' + qurl ) );
        return;
    }

    // add the approximations
    var now = new Date().getTime();
    var visible = queue.messages.filter( function ( message ) {
        return !message._inflight
            || message._inflight <= now;
    }).length;
    var invisible = queue.messages.length - visible;
    queue.attributes.ApproximateNumberOfMessages = visible;
    queue.attributes.ApproximateNumberOfMessagesNotVisible = invisible;

    var names = params.AttributeNames || [ 'All' ];

    var attributes = Object.keys( queue.attributes )
        .filter( function ( key ) {
            return names.indexOf( 'All' ) !== -1
                || names.indexOf( key ) !== -1
        })
        .reduce( function ( attributes, key ) {
            attributes[ key ] = queue.attributes[ key ]
            return attributes
        }, {} );

    setTimeout( function () {
        callback( null, { Attributes: attributes } )
    })

}

SQS.prototype.deleteQueue = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var qurl = params.QueueUrl;
    delete queues[ qurl ];

    setTimeout( function () {
        callback( null, {} )
    })
}

SQS.prototype.listQueues = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var prefix = params.QueueNamePrefix || '';
    var urls = Object.keys( queues )
        .filter( function ( qurl ) {
            var name = queues[ qurl ].name;
            return name.indexOf( prefix ) === 0;
        })

    setTimeout( function () {
        callback( null, {
            QueueUrls: urls
        })
    })
}

SQS.prototype.purgeQueue = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var qurl = params.QueueUrl;
    if ( !qurl ) {
        callback( new Error( 'QueueUrl is required' ) )
        return
    }

    var queue = queues[ qurl ];
    if ( !queue ) {
        callback( new Error( 'Queue doesn\'t exist for Url:' + qurl ) );
        return;
    }

    queue.messages = [];

    setTimeout( function () {
        callback( null, {} )
    })
}

SQS.prototype.sendMessage = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );

    var qurl = params.QueueUrl;
    if ( !qurl ) {
        callback( new Error( 'QueueUrl is required' ) )
        return
    }

    var body = params.MessageBody;
    if ( !body ) {
        callback( new Error( 'MessageBody is required' ) );
        return;
    }

    var queue = queues[ qurl ];
    if ( !queue ) {
        callback( new Error( 'Queue doesn\'t exist for Url:' + qurl ) );
        return;
    }

    var messageId = uuid.v4();
    var attributes = {
        SentTimestamp: new Date().getTime(),
        ApproximateReceiveCount: 0,
    };

    queue.messages.push({
        MessageId: messageId,
        Body: body,
        MessageAttributes: extend( {}, params.MessageAttributes ), // copy
        Attributes: attributes
    })

    setTimeout( function () {
        callback( null, {
            MessageId: messageId,
            ResponseMetadata: {RequestId: '232c557d-b1ed-54a1-a88c-180f7aaf3eb3'}
        })
    })
}

SQS.prototype.receiveMessage = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );
    var qurl = params.QueueUrl;
    if ( !qurl ) {
        callback( new Error( 'QueueUrl is required' ) );
        return;
    }

    var queue = queues[ qurl ];
    if ( !queue ) {
        callback( new Error( 'Queue doesn\'t exist for Url:' + qurl ) );
        return;
    }

    var max = params.MaxNumberOfMessages === undefined
        ? 1
        : params.MaxNumberOfMessages;

    if ( max > 10 || max < 1 ) {
        callback( new Error( 'MaxNumberOfMessages out of range' ) );
        return;
    }

    var vis = params.VisibilityTimeout === undefined
        ? queue.attributes.VisibilityTimeout
        : params.VisibilityTimeout;

    var now = new Date().getTime();
    var inflight = now + ( vis * 1000 );

    var messages = queue.messages;
    var received = messages
        .filter( function ( message ) {
            return !message._inflight
                || message._inflight <= now;
        })
        .slice( 0, max )
        .map( function ( message ) {
            message._inflight = inflight;
            message.ReceiptHandle = uuid.v4()
            message.Attributes.ApproximateReceiveCount += 1;
            if ( !message.Attributes.ApproximateFirstReceiveTimestamp ) {
                var timestamp = new Date().getTime();
                message.Attributes.ApproximateFirstReceiveTimestamp = timestamp;
            }

            message = extend( {}, message );
            delete message._inflight;
            return message;
        });

    setTimeout( function () {
        callback( null, {
            Messages: received
        })
    })
}

SQS.prototype.deleteMessage = function ( params, callback ) {
    callback = callback || function () {}
    params = extend( {}, this.params, params );
    var qurl = params.QueueUrl;
    if ( !qurl ) {
        callback( new Error( 'QueueUrl is required' ) );
        return;
    }

    var receipt = params.ReceiptHandle;
    if ( !receipt ) {
        callback( new Error( 'ReceiptHandle is required' ) );
        return;
    }

    var queue = queues[ qurl ];
    if ( !queue ) {
        callback( new Error( 'Queue doesn\'t exist for Url:' + qurl ) );
        return;
    }

    var message = queue.messages.filter( function ( message ) {
        return message.ReceiptHandle === receipt;
    })
    var idx = queue.messages.indexOf( message );
    queue.messages.splice( idx, 1 );

    setTimeout( function () {
        callback( null, {} )
    })
}


