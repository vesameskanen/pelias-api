FROM node:4.6.0
MAINTAINER Pelias

ENV PORT=8080
EXPOSE ${PORT}

# install libpostal
RUN apt-get update
RUN echo 'APT::Acquire::Retries "20";' >> /etc/apt/apt.conf
RUN apt-get install -y --no-install-recommends git curl libsnappy-dev autoconf automake libtool pkg-config

RUN mkdir -p /mnt/data/libpostal

RUN git clone https://github.com/openvenues/libpostal \
  && cd libpostal \
  && git checkout tags/v1.0.0 \
  && ./bootstrap.sh \
  && ./configure --datadir=/mnt/data/libpostal \
  && make \
  && make install \
  && ldconfig

# use our extended query module
ENV QUERY=/opt/pelias/query
WORKDIR ${QUERY}
RUN git clone --single-branch https://github.com/HSLdevcom/query.git \
  && cd query \
  && npm install \
  && npm link

# use our text-analyzer
ENV TEXT_ANALYZER=/opt/pelias/text-analyzer
WORKDIR ${TEXT_ANALYZER}
RUN git clone --single-branch https://github.com/HSLdevcom/pelias-text-analyzer.git \
  && cd pelias-text-analyzer \
  && npm install \
  && npm link

# Where the app is built and run inside the docker fs
ENV WORK=/opt/pelias/api

# Used indirectly for saving npm logs etc.
ENV HOME=/opt/pelias/api

WORKDIR ${WORK}
ADD . ${WORK}

# Build and set permissions for arbitrary non-root user
RUN npm install \
  && npm link pelias-query \
  && npm link pelias-text-analyzer \
  && npm test \
  && chmod -R a+rwX .

ADD pelias.json.docker pelias.json

ADD run.sh /usr/local/bin/

CMD /usr/local/bin/run.sh
