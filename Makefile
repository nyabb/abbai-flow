# Abbai Flow — developer tasks
#
# The app is web-only: a Vite build plus a small Node server. There are no
# native wrappers, so there is nothing here for Capacitor, Xcode or Android
# Studio. Container images are produced by .github/workflows/docker-image.yml;
# the targets below build and publish one by hand.

IMAGE ?= abbai-flow
TAG   := $(shell node -p "require('./package.json').version")

.PHONY: help dev build preview lint typecheck test test-server test-all format \
        docker-build docker-push clean

help:
	@grep -E '^[a-zA-Z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

dev: ## Development server (http://localhost:5173)
	npm run dev

build: ## Production build (types, server rules, Vite bundle into dist/)
	npm run build

preview: ## Preview the production build
	npm run preview

lint: ## ESLint
	npm run lint

typecheck: ## TypeScript type-check, no emit (app + scripts)
	npm run typecheck

test: ## Frontend tests
	npm run test

test-server: ## Server tests (node --test)
	npm run test:server

test-all: ## Both suites
	npm run test:all

format: ## Prettier
	npm run format

docker-build: ## Build the container image locally for this machine
	docker buildx build \
		--tag $(IMAGE):$(TAG) \
		--tag $(IMAGE):latest \
		--load \
		.

## Build and push amd64 + arm64 to a registry.
docker-push: ## Override IMAGE, e.g. `make docker-push IMAGE=ghcr.io/<owner>/abbai-flow`
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--tag $(IMAGE):$(TAG) \
		--tag $(IMAGE):latest \
		--push \
		.

clean: ## Remove build output and dependencies
	rm -rf dist server/build node_modules
