const server = require('../src/index');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const { expect } = chai;

describe('Bird Dropper App', () => {
  const testEmail = `test${Date.now()}@bird.com`;
  const password = 'Password123';

  it('should render the home page', done => {
    chai.request(server)
      .get('/')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.include('Bird Dropper');
        done();
      });
  });

  it('should register a new user and redirect to profile', done => {
    chai.request(server)
      .post('/register')
      .type('form')
      .send({
        first_name: 'Test',
        last_name: 'User',
        email: testEmail,
        username: `testuser${Date.now()}`,
        password: password,
        confirm_password: password
      })
      .end((err, res) => {
        expect(res).to.have.status(200); // or 302 if redirect happens
        expect(res.redirects[0] || res.text).to.include('/profile');
        done();
      });
  });

  it('should fail to login with wrong credentials', done => {
    chai.request(server)
      .post('/login')
      .type('form')
      .send({ email: 'wrong@email.com', password: 'wrongpass' })
      .end((err, res) => {
        expect(res.text).to.include('Invalid email or password');
        done();
      });
  });
});
