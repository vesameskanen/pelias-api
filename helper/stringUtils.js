var api = require('pelias-config').generate().api;

var equalCharMap = {}, equalRegex = {};

var localization = api && api.localization;
if (localization && localization.equalCharMap) {
  equalCharMap = localization.equalCharMap;
  for(var c in equalCharMap) {
    equalRegex[c] = new RegExp(c, 'gi');
  }
}

function normalize(s) {
  if(s) {
    s = s.toLowerCase();

    // map chars which are considered equal
    for(var c in equalCharMap) {
      s = s.replace(equalRegex[c], equalCharMap[c]);
    }
  }
  return s;
}

function removeSpaces(s) {
  return s.replace(/ /g, '');
}

function removeNumbers(s) {
  return s.replace(/[0-9]/g, '').trim();
}

module.exports = {
  normalize: normalize,
  removeSpaces: removeSpaces,
  removeNumbers: removeNumbers
};
