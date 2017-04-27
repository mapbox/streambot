'use strict';

const audit = require('@mapbox/cfn-template-audit');

const templateFilter = template => /streambot/.test(template);
audit
  .getWorldWideTemplates({ templateFilter })
  .then(data =>
    process.stdout.write(
      data
        .map(stack => `${stack.Summary.StackName} | ${stack.Region}`)
        .join('\n') + '\n'
    )
  )
  .catch(err => process.stderr.write(`${err.stack}\n`));
