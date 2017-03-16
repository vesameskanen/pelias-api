/**
 * Basic confidence score should be computed and returned for each item in the results.
 * The score should range between 0-1, and take into consideration as many factors as possible.
 */

var stats = require('stats-lite');
var logger = require('pelias-logger').get('api');
var check = require('check-types');
var _ = require('lodash');
var fuzzy = require('../helper/fuzzyMatch');
var languages = ['default'];
var equalCharMap = {}, equalRegex = {};
var adminWeights;
var minConfidence=0, relativeMinConfidence;

// default configuration for address confidence check
var confidenceAddressParts = {
  number: { parent: 'address_parts', field: 'number', numeric: true, weight: 0.5 },
  street: { parent: 'address_parts', field: 'street', numeric: false, weight: 1 },
  postalcode: { parent: 'address_parts', field: 'zip', numeric: false, weight: 1 },
  state: { parent: 'parent', field: 'region_a', numeric: false, weight: 3},
  country: { parent: 'parent', field: 'country_a', numeric: false, weight: 4 }
};

// layers priority in result sorting
var layers = [
  'stop',
  'station',
  'venue',
  'address',
  'street',
  'neighbourhood',
  'borough',
  'locality',
  'localadmin',
  'county',
  'macrocounty',
  'region',
  'macroregion',
  'dependency',
  'country'
];

function setup(peliasConfig) {
  if (check.assigned(peliasConfig)) {
    if (peliasConfig.languages) {
      languages = _.uniq(languages.concat(peliasConfig.languages));
    }
    if(peliasConfig.minConfidence) {
      minConfidence = peliasConfig.minConfidence;
    }
    if (peliasConfig.layerPriority) {
      layers = peliasConfig.layerPriority;
    }

    relativeMinConfidence = peliasConfig.relativeMinConfidence;
    var localization = peliasConfig.localization;
    if (localization) {
      if(localization.confidenceAdminWeights) {
        adminWeights = localization.confidenceAdminWeights;
      }
      if(localization.confidenceAddressParts) {
        confidenceAddressParts = localization.confidenceAddressParts;
      }
      if(localization.equalCharMap) {
        equalCharMap = localization.equalCharMap;
        for(var c in equalCharMap) {
          equalRegex[c] = new RegExp(c, 'gi');
        }
      }
    }
  }
  return computeScores;
}


// map chars which are considered equal in scoring
function normalize(s) {
  if(s) {
    for(var c in equalCharMap) {
      s = s.replace(equalRegex[c], equalCharMap[c]);
    }
  }
  return s;
}

function removeNumbers(val) {
  return val.replace(/[0-9]/g, '').trim();
}

function compareProperty(p1, p2) {
  if (Array.isArray(p1)) {
    p1 = p1[0];
  }
  if (Array.isArray(p2)) {
    p2 = p2[0];
  }

  if (!p1 || !p2) {
    return 0;
  }
  if (typeof p1 === 'string'){
    p1 = p1.toLowerCase();
  }
  if (typeof p2 === 'string'){
    p2 = p2.toLowerCase();
  }
  return (p1<p2?-1:(p1>p2?1:0));
}


/* Quite heavily fi specific sorting */
function compareResults(a, b) {
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  if(a.layer !== b.layer) { // larger has higher priority
    return layers.indexOf(b.layer) - layers.indexOf(a.layer);
  }
  if (a.distance !== b.distance) {  // focus point defined
    return a.distance - b.distance;
  }
  var diff;
  if (a.parent && b.parent) {
    diff = compareProperty(a.parent.localadmin, b.parent.localadmin);
    if (diff) {
      return diff;
    }
  }
  if (a.address_parts && b.address_parts) {
    diff = compareProperty(a.address_parts.street, b.address_parts.street);
    if (diff) {
      return diff;
    }

    var n1 = parseInt(a.address_parts.number);
    var n2 = parseInt(b.address_parts.number);
    if (!isNaN(n1) && !isNaN(n2)) {
      diff = compareProperty(n1, n2);
      if (diff) {
        return diff;
      }
    }
  }
  if (a.name && b.name) {
    diff = compareProperty(a.name.default, b.name.default);
    if (diff) {
      return diff;
    }
  }

  return 0;
}


function computeScores(req, res, next) {
  // do nothing if no result data set
  if (!check.assigned(req.clean) || !check.assigned(res) ||
      !check.assigned(res.data) || res.data.length===0 || !check.assigned(res.meta)) {
    return next();
  }

  // loop through data items and determine confidence scores
  res.data = res.data.map(computeConfidenceScore.bind(null, req));

  res.data.sort(compareResults);

  // don't return poor results
  var bestConfidence = res.data[0].confidence;
  var limit = minConfidence;
  if(relativeMinConfidence) {
    limit = Math.max(limit, relativeMinConfidence * bestConfidence);
  }
  res.data = res.data.filter(function(doc) {
    return(doc.confidence>limit);
  });

  next();
}

function countWords(str) {
  return str.split(/\s+/).length;
}

/**
 * Check all types of things to determine how confident we are that this result
 * is correct.
 *
 * @param {object} req
 * @param {object} hit
 * @returns {object}
 */
function computeConfidenceScore(req, hit) {

  var parsedText = req.clean.parsed_text;

  // compare parsed name (or raw text) against configured language versions of name
  hit.confidence = checkName(req.clean.text, parsedText, hit);
  var weightSum=1;

  // compare address parts one by one
  if (parsedText) {
    for(var key in confidenceAddressParts) {
      if(check.assigned(parsedText[key])) {
        hit.confidence += confidenceAddressParts[key].weight*checkAddressPart(parsedText, hit, key);
        weightSum += confidenceAddressParts[key].weight;
      }
    }
  }

  // score admin areas such as city or neigbourhood
  if(adminWeights) {
    var adminConfidence;

    if(parsedText && parsedText.regions) {
      adminConfidence = checkAdmin(parsedText.regions, hit);

      // Keep admin scoring proportion constant 50% regardless of the
      // count of finer score factors. Score is max 0.5 if city is all wrong
      hit.confidence += weightSum*adminConfidence;
      weightSum *= 2;
    } else if(hit.confidence<1 && countWords(req.clean.text)>1) {

      // Text could not be parsed, and does not match any document perfectly.
      // There is a chance that text contains admin info like small city without
      // comma separation (libpostal misses those), or name is formatted loosely
      // 'tampereen keskustori'. So check raw text against admin areas
      adminConfidence = checkAdmin(req.clean.text, hit);
      hit.confidence += (1 - hit.confidence)*adminConfidence; // leftover from name match
    }
    if(adminConfidence) {
      logger.debug('admin confidence', adminConfidence);
    }
  }

  hit.confidence /= weightSum; // normalize

  // TODO: look at categories
  logger.debug('### confidence', hit.confidence);

  return hit;
}


/**
 * Compare text string against configuration defined language versions of the name
 *
 * @param {string} text
 * @param {object} document with name and other props
 * @param {bool} remove numbers from examined property
 * @param {bool} variate names with admin parts & street
 * @returns {bool}
 */

function checkLanguageNames(text, doc, stripNumbers, tryGenitive) {
  var bestScore = 0;
  var bestName;
  var names = doc.name;

  text = normalize(text);

  var checkNewBest = function(name) {
    var score = fuzzy.match(text, name);
    logger.debug('######', text, '|', name, score);
    if (score >= bestScore ) {
      bestScore = score;
      bestName = name;
    }
  };

  var checkAdminName = function(admin, name) {
    admin = normalize(admin);
    if(admin && name.indexOf(admin) === -1) {
      checkNewBest(admin + ' ' + name);
    }
  };

  var checkAdminNames = function(admins, name) {
    admins.forEach(function(admin) {
      checkAdminName(admin, name);
    });
  };

  for (var lang in names) {
    if (languages.indexOf(lang) === -1) {
      continue;
    }
    var score;
    var name = normalize(names[lang]);
    if(stripNumbers) {
      name = removeNumbers(name);
    }
    checkNewBest(name);

    if (tryGenitive && text.length > 2 + name.length) { // Shortest admin prefix is 'ii '
      // prefix with parent admins to catch cases like 'kontulan r-kioski'
      var parent = doc.parent;
      for(var key in adminWeights) {
        var admins = parent[key];
        if (Array.isArray(admins)) {
          checkAdminNames(admins, name);
        } else {
          checkAdminName(admins, name);
        }
      }
      // try also street: 'helsinginkadun r-kioski'
      checkAdminName(doc.street, name);
    }
  }
  logger.debug('name confidence', bestScore, text, bestName);

  return bestScore;
}


/**
 * Compare text string or name component of parsed_text against
 * default name in result
 *
 * @param {string} text
 * @param {object|undefined} parsedText
 * @param {object} hit
 * @returns {number}
 */
function checkName(text, parsedText, hit) {

  var isVenue = hit.layer === 'venue' || hit.layer === 'stop' || hit.layer === 'station';

  // parsedText name should take precedence if available since it's the cleaner name property
  if (check.assigned(parsedText) && check.assigned(parsedText.name)) {
    var name = parsedText.name;
      var bestScore = checkLanguageNames(name, hit, false, isVenue);

    if (parsedText.regions && isVenue) {
      // try approximated genitive form : tuomikirkko, tampere -> tampere tuomiokirkko
      // exact genitive form is hard e.g. in finnish lang: turku->turun, lieto->liedon ...
      parsedText.regions.forEach(function(region) {
        region = normalize(removeNumbers(region));
        if( name.indexOf(region) === -1 ) { // not already included
          var score = checkLanguageNames(region + ' ' + name, hit);
          if (score > bestScore) {
            bestScore = score;
          }
        }
      });
    }
    return(bestScore);
  }

  // if no parsedText check the full unparsed text value
  return(checkLanguageNames(text, hit, false, true));
}


/**
 * Determine the quality of the property match
 *
 * @param {string|number} textProp
 * @param {string|number|undefined|null} hitProp
 * @param {boolean} numeric
 * @returns {number}
 */
function propMatch(textProp, hitProp, numeric) {

  // missing information is not quite as bad as totally wrong data
  if (!check.assigned(hitProp)) {
    return 0.1;
  }

  if (numeric) { // special treatment for numbers such as house number
    if(textProp === hitProp) {
      // handle exact match before dropping all but numeric part
      return 1.0;
    }
    var n1 = parseInt(textProp); // e.g. 4b -> 4, 3-5 -> 3
    var n2 = parseInt(hitProp);
    if (!isNaN(n1) && !isNaN(n2)) {
      return Math.sqrt(0.9/(1.0 + Math.abs(n1-n2)));
    }
  }

  return fuzzy.match(normalize(textProp.toString()), normalize(hitProp.toString()));
}

// array wrapper for function above
function propMatchArray(text, hitProp, numeric) {
  if (Array.isArray(hitProp)) { // check all array values
    var maxMatch = 0;
    hitProp.forEach(function(value) {
      var match = propMatch(text, value, numeric);
      if (match>maxMatch) {
        maxMatch=match;
      }
    });
    return maxMatch;
  } else {
    return propMatch(text, hitProp, numeric);
  }
}


/**
 * Check a defined part of the parsed text address
 *
 * @param {object} text
 * @param {object} hit
 * @param {string} key
 */
function checkAddressPart(text, hit, key) {
  var value;
  var part = confidenceAddressParts[key];
  var parent = hit[part.parent];

  if (!parent) {
    value = null;
  } else {
    value = parent[part.field];
  }
  var score = propMatchArray(text[key], value, part.numeric);

  // special case: proper version can be stored in the name
  // we need this because street name currently stores only one language
  if(key==='street' && hit.name) {
      var _score = checkLanguageNames(text[key], hit, true, false);
    if(_score>score) {
      score = _score;
    }
  }
  logger.debug('address confidence for ' + key, score);

  return score;
}


/**
 * Check admin properties against parsed values
 *
 * @param {values} text/array
 * @param {object} hit
 * @param {object} [hit.parent]
 * @returns {number}
 */
function checkAdmin(values, hit) {
  if (!Array.isArray(values)) {
    values = [values];
  }

  var sum=0, weightSum=0;

  values.forEach(function(value) {
    var best=0, weight = 1;
    var nvalue = normalize(value);

    // loop trough configured properties to find best match
    for(var key in adminWeights) {
      var prop = hit.parent[key];
      if (prop) {
        var match;
        if ( Array.isArray(prop) ) {
          var nProp = [];
          for(var i in prop) {
            nProp.push(normalize(prop[i]));
          }
          match = fuzzy.matchArray(nvalue, nProp);
        } else {
          match = fuzzy.match(nvalue, normalize(prop));
        }
        if(match>best) {
          best = match;
          weight = adminWeights[key];
        }
      }
    }
    sum += weight*best;
    weightSum += weight;
  });

  return sum/weightSum;
}

module.exports = setup;
