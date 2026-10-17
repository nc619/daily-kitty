plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dailykitty.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dailykitty.widget"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "2.0"
    }

    // A fixed key so new versions install over old ones. This app only shows pictures,
    // so the key living in the repo is an acceptable trade-off for a two-person app.
    signingConfigs {
        create("kitty") {
            storeFile = file("../kitty-widgets.p12")
            storeType = "pkcs12"
            storePassword = "kittywidgets"
            keyAlias = "kittywidgets"
            keyPassword = "kittywidgets"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("kitty")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
}
