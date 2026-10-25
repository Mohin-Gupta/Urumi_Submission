#!/bin/sh
# Idempotent: runs on every install and upgrade.
set -eu
cd /var/www/html

echo "Waiting for WordPress files and database..."
until [ -f wp-config.php ] && wp db check >/dev/null 2>&1; do sleep 5; done

wp core is-installed || wp core install --skip-email \
  --url="$STORE_URL" --title="$STORE_TITLE" \
  --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASSWORD" --admin_email="$ADMIN_EMAIL"

# The image only seeds core files on an empty volume, so upgrades happen here
wp core update --version="$WP_VERSION"
wp core update-db

# Re-applied every run, so moving to a new domain is only a values change
wp option update home "$STORE_URL"
wp option update siteurl "$STORE_URL"
wp option update timezone_string "$TIMEZONE"
wp rewrite structure '/%postname%/'

# Pinned versions: install or move to the version in values, then run any database updates
[ "$(wp plugin get woocommerce --field=version 2>/dev/null)" = "$WC_VERSION" ] ||
  wp plugin install woocommerce --version="$WC_VERSION" --force
wp plugin activate woocommerce
wp wc update
[ "$(wp theme get storefront --field=version 2>/dev/null)" = "$STOREFRONT_VERSION" ] ||
  wp theme install storefront --version="$STOREFRONT_VERSION" --force
wp theme activate storefront

wp option update woocommerce_currency "$CURRENCY"
# New stores start in "coming soon" mode, which hides the shop from customers
wp option update woocommerce_coming_soon no
wp option update woocommerce_onboarding_profile '{"skipped":true}' --format=json
wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery"}' --format=json
wp wc tool run install_pages --user="$ADMIN_USER"

# WooCommerce stores API keys hashed, so we insert the key from our Secret directly
wp eval '
global $wpdb;
$table = $wpdb->prefix . "woocommerce_api_keys";
$key = getenv("WC_CONSUMER_KEY");
$wpdb->delete($table, ["description" => "mcp-server"]);
$wpdb->insert($table, [
  "user_id" => get_user_by("login", getenv("ADMIN_USER"))->ID,
  "description" => "mcp-server",
  "permissions" => "read_write",
  "consumer_key" => wc_api_hash($key),
  "consumer_secret" => getenv("WC_CONSUMER_SECRET"),
  "truncated_key" => substr($key, -7),
]);'

if [ "$(wp post list --post_type=product --format=count)" = 0 ]; then
  wp wc product create --user="$ADMIN_USER" --name="Classic Tee" --regular_price=499 --status=publish
  wp wc product create --user="$ADMIN_USER" --name="Coffee Mug" --regular_price=299 --status=publish
  wp wc product create --user="$ADMIN_USER" --name="Canvas Tote" --regular_price=349 --status=publish
fi

echo "Store ready at $STORE_URL"
