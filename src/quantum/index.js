/**
 * Quantum simulation and analysis layer: simulators (statevector, density
 * matrix, stabilizer), noise, analysis, sweeps, importers and exporters.
 * Everything consumes the circuit IR from `qubi/ir.js`.
 *
 * @module quantum
 */

export {
  zeros, identity, toComplex, fromArray, toArray, clone, get, multiply, multiplyAll, add, subtract, scale,
  adjoint, transpose, conjugate, kron, trace, frobeniusNorm, wireOffsets, partialTrace, hermitianEigen,
  hermitianFunction, sqrtPsd, unitaryEigen, svd, determinant, equals, equalsUpToPhase, isUnitary, isHermitian,
} from './cmatrix.js';
export { gateMatrix, baseGateName, opActions, checkWires } from './gates.js';
export { applyMatrix } from './kernel.js';
export { parsePauli, pauliPhase, popcount } from './pauli.js';
export { createRng } from './rng.js';
export { evaluateCondition } from './condition.js';
export { StatevectorSimulator, createBackend, bitstring } from './statevector.js';
export { executeCircuit, runCircuit, outcomeDistribution } from './run.js';
export { DensityMatrixSimulator } from './density.js';
export {
  depolarizing, depolarizing2, amplitudeDamping, phaseDamping, bitFlip, phaseFlip,
  ReadoutError, NoiseModel, simulateNoisy, fidelityDecay,
} from './noise.js';
export { StabilizerSimulator, isClifford } from './stabilizer.js';
export {
  describeState, densityMatrixOf, reducedDensityMatrix, blochVector, blochVectors, blochAngles, stateToBloch,
  blochToPreparation, qsphere, schmidtDecomposition, entanglementEntropy, mutualInformation,
  mutualInformationMatrix, concurrence, purity, fidelity, traceDistance, pauliExpectation, pauliVariance,
  expectationValue, observableVariance, commutator, anticommutator, chsh, bornRule, geodesic,
  vonNeumannEntropy, circuitUnitary, unitarySteps, decomposeZYZ, uGateParams, eulerDecompose,
  decomposeControlled, decomposeTwoQubit, unitaryPath, gateOp,
  exactForm, diracTerms, formatDirac, diracOptionsFromSettings,
} from './analysis.js';
export { controlledName, lowerOp } from './lower.js';
export { sweepProbabilities, parsePattern } from './sweep.js';
export { importOpenQasm } from './import/openqasm.js';
export { importQiskit } from './import/qiskit.js';
export { importCirq } from './import/cirq.js';
export { emitQubi, qubiAngle } from './import/emit.js';
export { toOpenQasm2, toOpenQasm3 } from './export/openqasm.js';
export { toQiskitJson } from './export/qiskit.js';
export { toCirqJson } from './export/cirq.js';
