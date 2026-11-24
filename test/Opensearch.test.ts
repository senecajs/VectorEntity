/* Copyright © 2024 Seneca Project Contributors, MIT License. */

require('dotenv').config({ path: '.env.local' })


import Seneca from 'seneca'

import VectorStoreDoc from '../src/VectorStoreDoc'
import VectorStore from '../src/VectorStore'
import { OpensearchDriver } from '../src/driver/OpensearchDriver'


const OPENSEARCH_NODE = process.env.SENECA_OPENSEARCH_TEST_NODE
const OPENSEARCH_INDEX = process.env.SENECA_OPENSEARCH_TEST_INDEX
const opensearchAvailable = Boolean(OPENSEARCH_NODE)
const describeOpensearch = opensearchAvailable ? describe : describe.skip

// The live suite runs against AWS OpenSearch Serverless (aoss) or a local OpenSearch node
// with the k-NN plugin (security off, plain HTTP), such as the test services container:
//
//   SENECA_OPENSEARCH_TEST_NODE=http://127.0.0.1:19200
//
// The two differ, and the plugin is written for aoss:
// * aoss: the vector index of the collection is normally created beforehand; name it with
//   SENECA_OPENSEARCH_TEST_INDEX. There is no refresh call: a write becomes searchable after
//   the collection's refresh interval, 5 s for NextGen and 60 s for Classic vector
//   collections, so set SENECA_OPENSEARCH_TEST_WAIT (ms, default 2222) to match.
// * Local node: without SENECA_OPENSEARCH_TEST_INDEX the suite creates a fresh k-NN index
//   for this run and deletes it afterwards (an index named by SENECA_OPENSEARCH_TEST_INDEX
//   that does not exist yet is also created, and kept). The node refreshes every second.
// The driver always signs requests with SigV4 for the aoss service. A local node ignores the
// signature, but the signer needs credentials, so for a local node the suite sets dummy AWS
// credentials when none are in the environment.
const OPENSEARCH_WAIT = Number(process.env.SENECA_OPENSEARCH_TEST_WAIT) || 2222
const LIVE_TIMEOUT = 22222 + 2 * OPENSEARCH_WAIT

const OPENSEARCH_LOCAL =
  null != OPENSEARCH_NODE &&
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(OPENSEARCH_NODE)

if (OPENSEARCH_LOCAL) {
  process.env.AWS_ACCESS_KEY_ID ??= 'test'
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test'
  process.env.AWS_REGION ??= 'us-east-1'
}

const testIndex: string =
  OPENSEARCH_INDEX ||
  'vector-store-test-' + Date.now().toString(36) + '-' + process.pid

let createdIndex = false


describe('OpensearchDriver (via VectorStore)', () => {
  test('plugin defined', () => {
    expect(VectorStore).toBeDefined()
    expect(VectorStoreDoc).toBeDefined()
  })


  test('utils.resolveTable', () => {
    const utils = (VectorStore as any)['utils']
    const resolveTable = utils.resolveTable
    const seneca = makeSenecaBase()
    const ent0 = seneca.make('foo')
    const ent1 = seneca.make('foo/bar')

    expect(resolveTable(ent0, { index: {} })).toEqual('foo')
    expect(resolveTable(ent0, { index: { exact: 'qaz' } })).toEqual('qaz')

    expect(resolveTable(ent1, { index: {} })).toEqual('foo_bar')
    expect(resolveTable(ent1, { index: { prefix: 'p0', suffix: 's0' } })).toEqual('p0_foo_bar_s0')
    expect(resolveTable(ent1, {
      index: { map: { '-/foo/bar': 'FOOBAR' }, prefix: 'p0', suffix: 's0' }
    }))
      .toEqual('FOOBAR')

    // table alias produces the same result as index
    expect(resolveTable(ent1, { table: { exact: 'qaz' } })).toEqual('qaz')
    expect(resolveTable(ent1, { table: { prefix: 'p0', suffix: 's0' } })).toEqual('p0_foo_bar_s0')
    expect(resolveTable(ent1, {
      table: { map: { '-/foo/bar': 'FOOBAR' } }
    })).toEqual('FOOBAR')
  }, 22222)


  describeOpensearch('against live AWS OpenSearch (or a local node)', () => {
    beforeAll(async () => {
      const client = await makeClient()
      const exists = await client.indices.exists({ index: testIndex })
      if (!exists.body) {
        await client.indices.create({ index: testIndex, body: index_test01 })
        createdIndex = true
      }
    }, 22222)

    afterAll(async () => {
      if (createdIndex && !OPENSEARCH_INDEX) {
        const client = await makeClient()
        await client.indices.delete({ index: testIndex })
      }
    }, 22222)

    test('load-plugin', async () => {
      const seneca = makeSeneca()
      await seneca.ready()
      expect(seneca.export('VectorStore/native')).toBeDefined()
      await seneca.close()
    })


    test('insert-remove', async () => {
      const seneca = await makeSeneca()
      await seneca.ready()


      // no query params means no results
      const list0 = await seneca.entity('foo/chunk').list$()
      expect(0 === list0.length)

      const list1 = await seneca.entity('foo/chunk').list$({ test: 'insert-remove' })

      let ent0: any

      if (0 === list1.length) {
        ent0 = await seneca.entity('foo/chunk')
          .make$()
          .data$({
            test: 'insert-remove',
            text: 't01',
            vector: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            directive$: { vector$: true },
          })
          .save$()
        expect(ent0).toMatchObject({ test: 'insert-remove' })
        await new Promise((r) => setTimeout(r, OPENSEARCH_WAIT))
      }
      else {
        ent0 = list1[0]
      }

      await seneca.entity('foo/chunk').remove$(ent0.id)

      await new Promise((r) => setTimeout(r, OPENSEARCH_WAIT))

      const list2 = await seneca.entity('foo/chunk').list$({ test: 'insert-remove' })
      expect(list2.filter((n: any) => n.id === ent0.id)).toEqual([])

      await seneca.close()
    }, LIVE_TIMEOUT)


    test('vector-cat', async () => {
      const seneca = await makeSeneca()
      await seneca.ready()

      const list1 = await seneca.entity('foo/chunk').list$({ test: 'vector-cat' })

      if (!list1.find((n: any) => 'code0' === n.code)) {
        await seneca.entity('foo/chunk')
          .make$()
          .data$({
            code: 'code0',
            test: 'vector-cat',
            text: 't01',
            vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
            directive$: { vector$: true },
          })
          .save$()
      }

      if (!list1.find((n: any) => 'code1' === n.code)) {
        await seneca.entity('foo/chunk')
          .make$()
          .data$({
            code: 'code1',
            test: 'vector-cat',
            text: 't01',
            vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
            directive$: { vector$: true },
          })
          .save$()
      }

      await new Promise((r) => setTimeout(r, OPENSEARCH_WAIT))

      const list2 = await seneca.entity('foo/chunk').list$({
        directive$: { vector$: { k: 2 } },
        vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      })
      expect(1 < list2.length).toEqual(true)

      const list3 = await seneca.entity('foo/chunk').list$({
        directive$: { vector$: { k: 2 } },
        vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        code: 'code0'
      })
      expect(list3.length).toEqual(1)

      await seneca.close()
    }, LIVE_TIMEOUT)
  })

})


function makeSenecaBase() {
  // Seneca without the VectorStore plugin — used for tests that only need ent.canon$().
  return Seneca({ legacy: false })
    .test()
    .use('@seneca/entity')
}


function makeSeneca() {
  return Seneca({ legacy: false })
    .test()
    .use('@seneca/entity')
    .use(VectorStore, {
      driver: 'opensearch',
      map: {
        'foo/chunk': '*'
      },
      index: {
        exact: testIndex,
      },
      opensearch: {
        node: OPENSEARCH_NODE,
      }
    })
}


async function makeClient() {
  const driver = new OpensearchDriver({
    opensearch: { node: OPENSEARCH_NODE as string },
    aws: { region: process.env.AWS_REGION || 'us-east-1' },
  })
  await driver.connect()
  return driver.getClient()
}


// k-NN index for the suite, created only when the index does not exist (see above).
// The mapping names no engine or method, so that each service applies its own default
// (aoss Classic collections do not support the lucene engine, and OpenSearch 3 no longer
// creates nmslib indexes).
const index_test01 = {
  mappings: {
    properties: {
      text: { type: 'text' },
      vector: {
        type: 'knn_vector',
        dimension: 8, // 1536,
      },
    },
  },
  settings: {
    index: {
      knn: true,
    },
  },
}
