import path from 'path';
import { Contract, Instance, Sig } from '../../src';
import {
  alicePkh,
  alicePk,
  alice,
  bob,
} from '../fixture/vars';
import { getTxOutputs } from '../test-util';
import {
  isOpReturn,
  Utxo,
  TxnDetailValueIn,
} from '../../src/interfaces';
import { createOpReturnOutput } from '../../src/util';
import { FailedSigCheckError, Reason } from '../../src/Errors';

describe('P2PKH', () => {
  let p2pkhInstance: Instance;
  beforeAll(() => {
    const P2PKH = Contract.import(path.join(__dirname, '..', 'fixture', 'p2pkh.json'), 'testnet');
    p2pkhInstance = P2PKH.new(alicePkh);
  });

  describe('send (to one)', () => {
    it('should fail when using incorrect function parameters', async () => {
      // given
      const to = p2pkhInstance.address;
      const amount = 10000;

      // when
      const expectPromise = expect(
        p2pkhInstance.functions
          .spend(alicePk, new Sig(bob))
          .send(to, amount),
      );

      // then
      await expectPromise.rejects.toThrow(FailedSigCheckError);
      await expectPromise.rejects.toThrow(Reason.SIG_NULLFAIL);
    });

    it('should succeed when using correct function parameters', async () => {
      // given
      const to = p2pkhInstance.address;
      const amount = 10000;

      // when
      const tx = await p2pkhInstance.functions
        .spend(alicePk, new Sig(alice))
        .send(to, amount);

      // then
      const txOutputs = getTxOutputs(tx);
      expect(txOutputs).toEqual(expect.arrayContaining([{ to, amount }]));
    });

    it('should fail when not enough satoshis are provided in utxos', async () => {
      // when
      const to = p2pkhInstance.address;
      const amount = 1000;
      const utxos = await p2pkhInstance.getUtxos();
      utxos.sort((a, b) => (a.satoshis > b.satoshis ? 1 : -1));
      const { utxos: gathered, failureAmount } = gatherUtxos(utxos, { amount });

      // send
      await expect(
        p2pkhInstance.functions
          .spend(alicePk, new Sig(alice))
          .send(to, failureAmount, { inputs: gathered }),
      ).rejects.toThrow();

      await expect(
        p2pkhInstance.functions
          .spend(alicePk, new Sig(alice))
          .send(to, failureAmount),
      ).resolves.toBeTruthy();
    });

    it('should succeed when defining its own utxos', async () => {
      expect.hasAssertions();

      // given
      const to = p2pkhInstance.address;
      const amount = 1000;
      const utxos = await p2pkhInstance.getUtxos();
      utxos.sort((a, b) => (a.satoshis > b.satoshis ? 1 : -1));
      const { utxos: gathered } = gatherUtxos(utxos, { amount });

      // when
      const receipt = await p2pkhInstance.functions
        .spend(alicePk, new Sig(alice))
        .send(to, amount, { inputs: gathered });

      // then
      for (const input of receipt.vin as TxnDetailValueIn[]) {
        expect(gathered.find(utxo => (
          utxo.txid === input.txid
          && utxo.vout === input.vout
          && utxo.satoshis === input.value
        ))).toBeTruthy();
      }
    });
  });

  describe('send (to many)', () => {
    it('should fail when using incorrect function parameters', async () => {
      // given
      const outputs = [
        { to: p2pkhInstance.address, amount: 10000 },
        { to: p2pkhInstance.address, amount: 20000 },
      ];

      // when
      const expectPromise = expect(
        p2pkhInstance.functions
          .spend(alicePk, new Sig(bob))
          .send(outputs),
      );

      // then
      await expectPromise.rejects.toThrow(FailedSigCheckError);
      await expectPromise.rejects.toThrow(Reason.SIG_NULLFAIL);
    });

    it('should succeed when using correct function parameters', async () => {
      // given
      const outputs = [
        { to: p2pkhInstance.address, amount: 10000 },
        { to: p2pkhInstance.address, amount: 20000 },
      ];

      // when
      const tx = await p2pkhInstance.functions
        .spend(alicePk, new Sig(alice))
        .send(outputs);

      // then
      const txOutputs = getTxOutputs(tx);
      expect(txOutputs).toEqual(expect.arrayContaining(outputs));
    });

    it('should support OP_RETURN data as an output', async () => {
      // given
      const outputs = [
        { opReturn: ['0x6d02', 'Hello, World!'] },
        { to: p2pkhInstance.address, amount: 10000 },
        { to: p2pkhInstance.address, amount: 20000 },
      ];

      // when
      const tx = await p2pkhInstance.functions
        .spend(alicePk, new Sig(alice))
        .send(outputs);

      // then
      const txOutputs = getTxOutputs(tx);
      const expectedOutputs = outputs.map(o => (
        isOpReturn(o) ? createOpReturnOutput(o) : o
      ));

      expect(txOutputs).toEqual(expect.arrayContaining(expectedOutputs));
    });
  });

  describe.skip('meep (to one)', () => {
    it('should succeed when using incorrect function parameters', async () => {
      await p2pkhInstance.functions
        .spend(alicePk, new Sig(bob))
        .meep(p2pkhInstance.address, 10000);
    });

    it('should succeed when using correct function parameters', async () => {
      await p2pkhInstance.functions
        .spend(alicePk, new Sig(alice))
        .meep(p2pkhInstance.address, 10000);
    });
  });

  describe.skip('meep (to many)', () => {
    it('should succeed when using incorrect function parameters', async () => {
      await p2pkhInstance.functions.spend(alicePk, new Sig(bob)).meep([
        { to: p2pkhInstance.address, amount: 15000 },
        { to: p2pkhInstance.address, amount: 15000 },
      ]);
    });

    it('should succeed when using correct function parameters', async () => {
      await p2pkhInstance.functions.spend(alicePk, new Sig(alice)).meep([
        { to: p2pkhInstance.address, amount: 15000 },
        { to: p2pkhInstance.address, amount: 15000 },
      ]);
    });
  });
});

function gatherUtxos(utxos: Utxo[], options?: {
  amount?: number,
  fees?: number
}): { utxos: Utxo[], total: number, failureAmount: number } {
  const targetUtxos: Utxo[] = [];
  let total = 0;
  let failureAmount = 0;
  // 1000 for fees
  const { amount = 0, fees = 1000 } = options || {};
  for (const utxo of utxos) {
    failureAmount += utxo.satoshis;
    if (total - fees > amount) break;
    total += utxo.satoshis;
    targetUtxos.push(utxo);
  }
  return {
    utxos: targetUtxos,
    total,
    failureAmount,
  };
}
