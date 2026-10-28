/**
 * Safe expression parser and evaluator for the Android Calculator disguise.
 * Absolutely NO eval() or Function() constructor calls.
 */

export class FormatError extends Error {
  constructor(message = 'Format error') {
    super(message);
    this.name = 'FormatError';
  }
}

export class DivideByZeroError extends Error {
  constructor(message = "Can't divide by zero") {
    super(message);
    this.name = 'DivideByZeroError';
  }
}

/**
 * Normalizes expression strings:
 * - strips whitespace
 * - maps × -> *, ÷ -> /, − -> -
 */
export function normalizeExpression(expr) {
  if (!expr) return '';
  return expr
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
}

/**
 * Tokenizes mathematical expression string into typed tokens
 */
function tokenize(expr) {
  const norm = normalizeExpression(expr);
  const tokens = [];
  let i = 0;
  const len = norm.length;

  while (i < len) {
    const ch = norm[i];

    // Number (including decimal)
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let hasDot = false;
      while (i < len && ((norm[i] >= '0' && norm[i] <= '9') || norm[i] === '.')) {
        if (norm[i] === '.') {
          if (hasDot) throw new FormatError();
          hasDot = true;
        }
        numStr += norm[i];
        i++;
      }
      if (numStr === '.') throw new FormatError();
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), raw: numStr });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }

    if (ch === '%') {
      tokens.push({ type: 'PERCENT', value: '%' });
      i++;
      continue;
    }

    if (ch === '(') {
      // Check for implicit multiplication: e.g. 5( -> 5*( or )( -> )*(
      const prev = tokens[tokens.length - 1];
      if (prev && (prev.type === 'NUMBER' || prev.type === 'PERCENT' || (prev.type === 'PAREN' && prev.value === ')'))) {
        tokens.push({ type: 'OP', value: '*' });
      }
      tokens.push({ type: 'PAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'PAREN', value: ')' });
      i++;
      // Check for implicit multiplication: e.g. )5 -> )*5
      if (i < len) {
        const nextChar = norm[i];
        if ((nextChar >= '0' && nextChar <= '9') || nextChar === '.' || nextChar === '(') {
          tokens.push({ type: 'OP', value: '*' });
        }
      }
      continue;
    }

    // Any invalid/unexpected character
    throw new FormatError();
  }

  return tokens;
}

/**
 * Recursive descent parser and evaluator
 */
export function evaluateExpression(expr) {
  const tokens = tokenize(expr);
  if (tokens.length === 0) return { result: 0, lastOp: null };

  let current = 0;

  function peek() {
    return tokens[current];
  }

  function previous() {
    return tokens[current - 1];
  }

  function isAtEnd() {
    return current >= tokens.length;
  }

  function check(type, value) {
    if (isAtEnd()) return false;
    const token = peek();
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }

  function advance() {
    if (!isAtEnd()) current++;
    return previous();
  }

  let capturedLastOp = null;

  // Expression -> Additive
  function parseExpression() {
    return parseAdditive();
  }

  // Additive -> Multiplicative ( ('+' | '-') Multiplicative )*
  function parseAdditive() {
    let left = parseMultiplicative();

    while (check('OP', '+') || check('OP', '-')) {
      const op = advance().value;

      // Handle percentage in addition/subtraction:
      // E.g. 100 + 20% => 100 + (100 * 0.20) = 120
      // Check if next term is a single number followed by %
      let right;
      const nextToken = peek();
      const afterNext = tokens[current + 1];

      if (nextToken && nextToken.type === 'NUMBER' && afterNext && afterNext.type === 'PERCENT') {
        advance(); // consume NUMBER
        advance(); // consume PERCENT
        const percentAmount = (left * nextToken.value) / 100;
        right = percentAmount;
        capturedLastOp = { op, operand: percentAmount, percentOriginal: nextToken.value };
      } else {
        right = parseMultiplicative();
        capturedLastOp = { op, operand: right };
      }

      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  // Multiplicative -> Unary ( ('*' | '/') Unary )*
  function parseMultiplicative() {
    let left = parseUnary();

    while (check('OP', '*') || check('OP', '/')) {
      const op = advance().value;
      const right = parseUnary();
      capturedLastOp = { op, operand: right };

      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new DivideByZeroError();
        }
        left = left / right;
      }
    }

    return left;
  }

  // Unary -> ('-' | '+') Unary | Primary
  function parseUnary() {
    if (check('OP', '-')) {
      advance();
      const val = parseUnary();
      return -val;
    }
    if (check('OP', '+')) {
      advance();
      return parseUnary();
    }
    return parsePrimary();
  }

  // Primary -> ( NUMBER | '(' Expression ')' ) [ '%' ]
  function parsePrimary() {
    let val;

    if (check('NUMBER')) {
      val = advance().value;
    } else if (check('PAREN', '(')) {
      advance(); // consume '('
      val = parseExpression();
      if (!check('PAREN', ')')) {
        throw new FormatError();
      }
      advance(); // consume ')'
    } else {
      throw new FormatError();
    }

    // Postfix percentage: 50% => 0.5
    while (check('PERCENT')) {
      advance();
      val = val / 100;
    }

    return val;
  }

  const result = parseExpression();

  if (!isAtEnd()) {
    throw new FormatError();
  }

  if (!Number.isFinite(result)) {
    throw new DivideByZeroError();
  }

  return { result, lastOp: capturedLastOp };
}

/**
 * Formats a numeric result to a clean, readable string
 */
export function formatNumber(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    return '0';
  }

  // Handle -0
  if (Object.is(num, -0)) num = 0;

  // Very large or very small numbers
  const abs = Math.abs(num);
  if (abs >= 1e12 || (abs > 0 && abs < 1e-9)) {
    return num.toExponential(6).replace(/e\+?/, 'e');
  }

  // Clean rounding of floating point imprecision (e.g. 0.1 + 0.2 = 0.3)
  const rounded = Number(num.toPrecision(12));
  return rounded.toString();
}

/**
 * Applies a repeated operation to a previous result
 * e.g. 5 + 3 = 8; repeated = gives 11, then 14
 */
export function applyRepeatOperation(baseResult, lastOp) {
  if (!lastOp || typeof baseResult !== 'number') return baseResult;
  const { op, operand } = lastOp;

  let newResult;
  if (op === '+') {
    newResult = baseResult + operand;
  } else if (op === '-') {
    newResult = baseResult - operand;
  } else if (op === '*') {
    newResult = baseResult * operand;
  } else if (op === '/') {
    if (operand === 0) throw new DivideByZeroError();
    newResult = baseResult / operand;
  } else {
    return baseResult;
  }

  if (!Number.isFinite(newResult)) {
    throw new DivideByZeroError();
  }

  return newResult;
}
