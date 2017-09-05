var check = require('check-types');

// validate inputs, convert types and apply defaults
function sanitize( raw, clean ){

  // error & warning messages
  var messages = { errors: [], warnings: [] };

  // valid input 'lang'
  if(check.nonEmptyString( raw.lang )) {
    clean.lang = raw.lang;
  }

  return messages;
}


function expected() {
  // add lang as a valid parameter
  return [{ name: 'lang' }];
}

// export function
module.exports = () => ({
  sanitize: sanitize,
  expected: expected
});

