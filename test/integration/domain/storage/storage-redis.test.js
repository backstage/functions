const expect = require('chai').expect;
const deepcopy = require('deepcopy');

const StorageRedis = require('../../../../lib/domain/storage/redis');
const config = require('../../../../lib/support/config');

describe('StorageRedis', () => {
  let storage;

  before(() => {
    const newOptions = deepcopy(config.redis);
    newOptions.enableOfflineQueue = true;
    newOptions.keyPrefix = 'test:';

    storage = new StorageRedis(newOptions);
  });

  describe('#ping()', () => {
    it('should return pong', (done) => {
      storage.ping().then((res) => {
        expect(res).to.be.eql('PONG');
        done();
      }, (err) => {
        done(err);
      });
    });
  });


  describe('#putCode() and #getCode()', () => {
    it('should write a hash for the code', (done) => {
      const code = {
        id: 'test',
        code: 'a = 1;',
        hash: '123',
      };
      storage.putCode('backstage', 'test', code)
        .then((x) => {
          expect(x).to.be.eql('OK');
          return storage.getCode('backstage', 'test');
        })
        .then((code2) => {
          expect(code2.id).to.be.eql('test');
          expect(code2.code).to.be.eql('a = 1;');
          expect(code2.hash).to.be.eql('123');
          done();
        }, (err) => {
          done(err);
        });
    });
  });


  describe('#getCode()', () => {
    describe('when code id is not found', () => {
      it('should yield a null', (done) => {
        storage.getCode('backstage', 'not-found').then((code) => {
          expect(code).to.be.null;
          done();
        }, (err) => {
          done(err);
        });
      });
    });

    // when code is found is already tested above
  });

  describe('#delete()', () => {
    it('should write a hash for the code', (done) => {
      const id = 'test';
      const namespace = 'backstage';
      const code = {
        id,
        code: 'a = 1;',
        hash: '123',
      };
      storage.putCode(namespace, id, code)
        .then((putResponse) => {
          expect(putResponse).to.be.eql('OK');
          return storage.deleteCode(namespace, id);
        })
        .then((deleteResponse) => {
          expect(deleteResponse).to.be.eql(1);
          return storage.getCode(namespace, id);
        })
        .then((code2) => {
          expect(code2).to.be.null;
          done();
        }, (err) => {
          done(err);
        });
    });
  });

  describe('#getCodeByCache', () => {
    describe('when code is not found in storage', () => {
      it('should populate item by preCache', (done) => {
        const preCache = (code) => {
          code.neverCalled = true;
          return code;
        };

        const namespace = 'backstage';
        const id = 'cache-000';

        storage
          .getCodeByCache(namespace, id, { preCache })
          .then((cacheResponse) => {
            expect(cacheResponse).to.be.null;
            done();
          }, (err) => {
            done(err);
          });
      });
    });

    describe('when code is not found in cache', () => {
      it('should populate item by preCache', (done) => {
        const preCache = (code) => {
          code.preCached = true;
          preCache.called = true;
          return code;
        };

        const namespace = 'backstage';
        const id = 'cache-01';
        const code = {
          id,
          code: 'b = 1;',
          hash: '123',
        };

        storage
          .putCode(namespace, id, code)
          .then((putResponse) => {
            expect(putResponse).to.be.eql('OK');
            return storage.getCodeByCache(namespace, id, { preCache });
          })
          .then((cacheResponse) => {
            expect(cacheResponse.preCached).to.be.true;
            expect(preCache.called).to.be.true;
            done();
          }, (err) => {
            done(err);
          });
      });
    });

    describe('when code is found in cache and not changed', () => {
      it('should return item by cache', (done) => {
        const preCache = (code) => {
          code.preCached = true;
          preCache.called = true;
          return code;
        };

        const namespace = 'backstage';
        const id = 'cache-02';
        const code = {
          id,
          code: 'b = 1;',
          hash: '123a',
        };

        storage
          .putCode(namespace, id, code)
          .then((putResponse) => {
            expect(putResponse).to.be.eql('OK');
            return storage.getCodeByCache(namespace, id, { preCache });
          })
          .then((cacheResponse) => {
            expect(cacheResponse.preCached).to.be.true;
            preCache.called = false;
            return storage.getCodeByCache(namespace, id, { preCache });
          })
          .then((cacheResponse) => {
            expect(cacheResponse.id).to.be.eql(id);
            expect(cacheResponse.code).to.be.eql('b = 1;');
            expect(cacheResponse.hash).to.be.eql('123a');
            expect(preCache.called).to.be.false;
            done();
          }, (err) => {
            done(err);
          });
      });
    });

    describe('when code is found in cache and is changed', () => {
      it('should repopulate changed item', (done) => {
        const preCache = (code) => {
          code.preCachedByHash = code.hash;
          preCache.called = true;
          return code;
        };

        const namespace = 'backstage';
        const id = 'cache-03';
        const code = {
          id,
          code: 'c = 1;',
          hash: '123a',
        };

        storage
          .putCode(namespace, id, code)
          .then((putResponse) => {
            expect(putResponse).to.be.eql('OK');
            // populate the cache
            return storage.getCodeByCache(namespace, id, { preCache });
          })
          .then((cacheResponse) => {
            expect(cacheResponse.preCachedByHash).to.be.eql('123a');

            // change item in database
            code.code = 'd = 2;';
            code.hash = '123b';
            return storage.putCode(namespace, id, code);
          })
          .then(() => {
            preCache.called = false;
            return storage.getCodeByCache(namespace, id, { preCache });
          })
          .then((cacheResponse) => {
            expect(cacheResponse.id).to.be.eql(id);
            expect(cacheResponse.code).to.be.eql('d = 2;');
            expect(cacheResponse.preCachedByHash).to.be.eql('123b');
            expect(cacheResponse.hash).to.be.eql('123b');
            expect(preCache.called).to.be.true;
            done();
          }, (err) => {
            done(err);
          });
      });
    });
  });
});
