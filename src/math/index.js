/**
 * Qubibyte Graphics math engine. State the math; the engine computes it and
 * returns every intermediate step as data (LaTeX, a rule name, and
 * token-matching hints between consecutive steps) for the renderer to
 * animate.
 *
 * Operations with a hand method return `{ok, result, latex, steps}` or a
 * structured `{ok: false, reason}` when something is out of reach.
 * @module math
 */

// Expressions: building, parsing, printing.
export {
  num, sym, constant, add, mul, pow, fn, eq, neg, sub, div, integral, deriv, limitNode, sumNode, matrixNode, bracket,
  listNode, withArgs, mapArgs, key, same, isNum, isNumValue, freeOf, symbols, substitute, replaceSubtree, size, walk,
  toExpr, FUNCTIONS, ZERO, ONE, MINUS_ONE, MathError,
} from './expr.js';
export { Rational, R0, R1, RM1, RHALF, bestRational, bigGcd, bigIntRoot } from './rational.js';
export { parse, ensureExpr, varName, substituteValues } from './parse.js';
export { toLatex, toLatexWithSpans, toText, GREEK_NAMES } from './latex.js';
export { matchTokens, makeStep, linkSteps } from './steps.js';

// Algebra.
export { simplify, expand, splitCoeff, isNegativeTerm, isNonNegative, piMultiple, subsSimplify } from './simplify.js';
export { factor } from './factor.js';
export {
  pTrim, pDeg, pAdd, pSub, pMul, pScale, pDivmod, pGcd, pMonic, pDeriv, pEval, pPrimitive, squareFree, rationalRoots,
  factorRational, polyCoeffs, toPoly, polyToExpr, coeffsToExpr, polyRootsNumeric,
} from './poly.js';
export { toRationalFunction, cancel, together, apart, factoredPoly, isRationalIn } from './ratfunc.js';
export { evaluate, compileReal, compileComplex } from './evaluate.js';
export { equivalent } from './equality.js';
export { solve, solveLinearSystem, newtonSystem } from './solve.js';

// Calculus.
export { differentiate, diff, implicitDerivative } from './diff.js';
export { integrate, integrateDefinite, integrateNumeric } from './integrate.js';
export { limit, infinitySign } from './limits.js';
export { taylor, laurent } from './series.js';
export { powerSeries } from './powerseries.js';
export { seriesConvergence, epsilonDelta } from './sequences.js';
export { laplace, inverseLaplace, solveODELaplace } from './laplace.js';

// Linear algebra.
export {
  Matrix, matrix, vector, identity, matAdd, matSub, matScale, matMul, multiply, transpose, adjoint, rref, rank, nullSpace,
  columnSpace, inverse, determinant, solveLinear, charPoly, eigen, jacobiEigen, diagonalize, svd, qrHouseholder,
  gramSchmidt, qrGramSchmidt, lu, coordinates, changeOfBasis, projectionMatrix, project, leastSquares, polar2D,
  interpolateMatrix2D,
} from './linalg.js';
export { Surd, F as scalarOps, toScalar, scalarToExpr, scalarLatex, sqrtRational } from './scalar.js';

// Complex analysis.
export { Complex, rootsOfUnity, nthRoots } from './complex.js';
export { domainColor, domainColoring, conformalGrid, riemannSurface, contourIntegral, circlePath, residues } from './complexviz.js';

// Vector calculus and geometry.
export {
  gradient, divergence, curl, gradientNumeric, divergenceNumeric, curlNumeric, lineIntegral, surfaceIntegral,
  tangentPlane, surfaceNormal, curvature, geodesic,
} from './vectorcalc.js';
export {
  classifyConic, lineLine, lineCircle, circleCircle, perpendicularBisector, angleBisector, rotation2D, scaling2D,
  shear2D, reflection2D, affine2D, transformPoints, cyclicGroup, dihedralGroup, cayleyTable,
} from './geometry.js';

// Numerics.
export { bisection, newton, secant, brent } from './roots.js';
export { gradientDescent, nelderMead, goldenSection } from './optimize.js';
export { euler, midpoint, rk4, rk4Step, rk45 } from './ode.js';
export { heat1D, wave1D, wave2D } from './pde.js';
export { lagrange, newtonDividedDifferences, naturalCubicSpline, catmullRom } from './interpolate.js';
export { gaussKronrod, riemannSum, numericDerivative } from './quadrature.js';
export { fourierCoefficients, fourierSeriesExact, dft, fft, epicycles } from './fourier.js';
export {
  lnGamma, gamma as gammaFunction, beta as betaFunction, erf, erfc, gammaP, gammaQ, betaI, ellipticK,
} from './special.js';

// Probability and statistics.
export { SeededRandom } from './random.js';
export {
  normal, binomial as binomialDistribution, poisson, uniform, exponential, beta as betaDistribution, gammaDist,
  chiSquared, studentT, describe, histogram, cltSampleMeans, betaBinomialUpdate, discreteBayes, polynomialRegression,
  linearRegression, exponentialRegression, logisticRegression,
} from './stats.js';
export { markovChain } from './markov.js';

// Discrete math.
export {
  createGraph, bfs, dfs, dijkstra, bellmanFord, aStar, prim, kruskal, topologicalSort, stronglyConnectedComponents,
  maxFlow, circularLayout, gridLayout, forceLayout, treeFromGraph, treeLayout, treeTraversals,
} from './graph.js';
export {
  factorial, binomial, permutationsCount, permutations, combinations, catalan, stirlingFirst, stirlingSecond,
  partitionCount, partitions,
} from './combinatorics.js';
export {
  sieve, gcd, lcm, extendedGcd, modPow, modInverse, crt, isPrime, factorize, totient, continuedFraction,
} from './numtheory.js';
export { runDFA, runNFA, epsilonClosure, subsetConstruction } from './automata.js';
export {
  union, intersection, difference, symmetricDifference, complement, powerSet, cartesianProduct, vennRegions,
} from './sets.js';

// Physics and units.
export {
  DimensionError, Quantity, quantity, convert, parseUnit, describeDimension, dimensionFormula, assertDimension,
  sigFigs, decimalPlaces, roundSig, sigFigArithmetic,
} from './units.js';
export {
  suvat, springOscillator, pendulum, keplerOrbit, nBody, interference, doubleSlit, standingWave,
} from './physics.js';

// Presentation.
export { formatValue, recognizeRadical } from './format.js';
