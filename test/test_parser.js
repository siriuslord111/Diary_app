import {
  evaluateExpression,
  formatNumber,
  applyRepeatOperation,
  normalizeExpression,
  FormatError,
  DivideByZeroError
} from './parser.js';

let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`ERROR in ${name}:`, err);
  }
}

test('Basic Arithmetic', () => {
  assert(evaluateExpression('2 + 3').result === 5, '2 + 3 = 5');
  assert(evaluateExpression('10 − 4').result === 6, '10 − 4 = 6');
  assert(evaluateExpression('6 × 7').result === 42, '6 × 7 = 42');
  assert(evaluateExpression('15 ÷ 3').result === 5, '15 ÷ 3 = 5');
});

test('Decimals & Floating Point Precision', () => {
  const r1 = evaluateExpression('0.1 + 0.2').result;
  assert(formatNumber(r1) === '0.3', '0.1 + 0.2 formatted as 0.3');
  assert(evaluateExpression('3.5 * 2').result === 7, '3.5 * 2 = 7');
});

test('Negative Numbers and Unary', () => {
  assert(evaluateExpression('-5 + 3').result === -2, '-5 + 3 = -2');
  assert(evaluateExpression('4 * -2').result === -8, '4 * -2 = -8');
  assert(evaluateExpression('-(3 + 2)').result === -5, '-(3 + 2) = -5');
});

test('Parentheses & Precedence', () => {
  assert(evaluateExpression('2 + 3 * 4').result === 14, '2 + 3 * 4 = 14');
  assert(evaluateExpression('(2 + 3) * 4').result === 20, '(2 + 3) * 4 = 20');
  assert(evaluateExpression('(2 + 3)(4 + 1)').result === 25, 'Implicit multiplication (2+3)(4+1) = 25');
  assert(evaluateExpression('5(2 + 1)').result === 15, 'Implicit multiplication 5(2+1) = 15');
});

test('Percentage', () => {
  assert(evaluateExpression('50%').result === 0.5, '50% = 0.5');
  assert(evaluateExpression('200 * 15%').result === 30, '200 * 15% = 30');
  assert(evaluateExpression('100 + 10%').result === 110, '100 + 10% = 110');
  assert(evaluateExpression('100 - 15%').result === 85, '100 - 15% = 85');
});

test('Divide by zero', () => {
  let threw = false;
  try {
    evaluateExpression('5 / 0');
  } catch (e) {
    if (e instanceof DivideByZeroError) threw = true;
  }
  assert(threw, "5 / 0 throws DivideByZeroError");
});

test('Format error', () => {
  const invalid = ['5 +', '5 + * 3', '((3+2)', '..5', 'abc', ')3('];
  for (const expr of invalid) {
    let threw = false;
    try {
      evaluateExpression(expr);
    } catch (e) {
      if (e instanceof FormatError) threw = true;
    }
    assert(threw, `Invalid expression "${expr}" throws FormatError`);
  }
});

test('Repeated Equals', () => {
  const eval1 = evaluateExpression('5 + 3');
  assert(eval1.result === 8, '5 + 3 = 8');
  const rep1 = applyRepeatOperation(eval1.result, eval1.lastOp);
  assert(rep1 === 11, 'Repeated = gives 11');
  const rep2 = applyRepeatOperation(rep1, eval1.lastOp);
  assert(rep2 === 14, 'Repeated = gives 14');

  const eval2 = evaluateExpression('10 * 2');
  const rep21 = applyRepeatOperation(eval2.result, eval2.lastOp);
  assert(rep21 === 40, '10 * 2 repeated = gives 40');
});

test('Normalization', () => {
  assert(normalizeExpression(' 12 + 34 × 5 ÷ 2 − 1 ') === '12+34*5/2-1', 'Normalization maps symbols correctly');
});

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
